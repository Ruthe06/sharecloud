console.log("App loaded");
// Connect to socket.io on current domain 
const socket = io(location.origin);
console.log("Socket.IO connected: ", socket);

// Global state
let peerConnection, dataChannel, currentRoom;
let fileInput = document.getElementById('fileInput');
let fileLabel = document.getElementById('fileLabel');
let shareArea = document.getElementById('shareArea');
let senderSection = document.getElementById('senderSection');
let receiverSection = document.getElementById('receiverSection');
let recvProgress = document.getElementById('recvProgress');
let sendProgress = document.getElementById('sendProgress');
// ...add other DOM refs as needed...

let receiveBuffer = [], receivedSize = 0, chunkSize = 128 * 1024, expectedSize = 0, fileMeta = {};
let fileReader;

function generateShareLink() {
  currentRoom = Math.random().toString(36).substring(2, 8).toUpperCase();
  const link = `${window.location.origin}?room=${currentRoom}`;
  shareArea.innerHTML = `
    <span>Share this link:</span>
    <input type="text" readonly value="${link}">
    <button onclick="navigator.clipboard.writeText('${link}')">Copy Link</button>
  `;
  senderSection.style.display = "block";
  socket.emit('join-room', currentRoom);
  console.log("Sender joined room", currentRoom);
}

// SENDER: select and send file
fileInput.addEventListener('change', function() {
  fileLabel.textContent = fileInput.files[0] ? fileInput.files[0].name : "Select, or drag & drop file";
});

// Main send action
function sendFile() {
  const file = fileInput.files[0];
  if (!file) return alert("Choose a file first!");

  peerConnection = new RTCPeerConnection({
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' }
    ]
  });
  console.log("SEND: PeerConnection created");

  dataChannel = peerConnection.createDataChannel("filetransfer");
  dataChannel.binaryType = "arraybuffer";
  dataChannel.onopen = () => {
    console.log("SEND: Data channel opened");
    sendInChunks(file);
  };
  dataChannel.onclose = () => console.log("SEND: Data channel closed");

  peerConnection.onicecandidate = e => {
    if (e.candidate) {
      console.log("SEND: ICE candidate", e.candidate);
      socket.emit('signal', { room: currentRoom, data: { candidate: e.candidate } });
    }
  };

  peerConnection.createOffer()
    .then(offer => {
      console.log("SEND: Created offer");
      return peerConnection.setLocalDescription(offer);
    })
    .then(() => {
      socket.emit('signal', { room: currentRoom, data: { sdp: peerConnection.localDescription } });
    });

  socket.on('signal', async ({ data }) => {
    console.log("SEND: Received signal", data);
    if (data.sdp) {
      await peerConnection.setRemoteDescription(new RTCSessionDescription(data.sdp));
    } else if (data.candidate) {
      await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
      console.log("SEND: ICE candidate added");
    }
  });
}

function sendInChunks(file) {
  let offset = 0;
  let chunkSize = 128 * 1024;
  const reader = new FileReader();

  reader.onload = e => {
    if (dataChannel.readyState !== "open") {
      return alert("Data channel closed!");
    }
    dataChannel.send(e.target.result);
    offset += e.target.result.byteLength;
    sendProgress.value = offset / file.size;
    if (offset < file.size) {
      readSlice(offset);
    } else {
      dataChannel.close();
      console.log("SEND: File sent, datachannel closed");
    }
  };

  const readSlice = o => {
    const slice = file.slice(o, o + chunkSize);
    reader.readAsArrayBuffer(slice);
  };

  readSlice(0);
}

// RECEIVER LOGIC
window.onload = () => {
  const params = new URLSearchParams(window.location.search);
  if (params.has('room')) {
    currentRoom = params.get('room');
    receiverSection.style.display = "block";
    senderSection.style.display = "none";
    socket.emit('join-room', currentRoom);
    console.log("RECEIVER: joined room", currentRoom);

    peerConnection = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' }
      ]
    });

    peerConnection.ondatachannel = ev => {
      dataChannel = ev.channel;
      dataChannel.binaryType = "arraybuffer";
      dataChannel.onopen = () => console.log("RECV: Data channel opened");
      dataChannel.onclose = () => console.log("RECV: Data channel closed");
      dataChannel.onmessage = event => {
        receiveBuffer.push(event.data);
        receivedSize += event.data.byteLength;
        recvProgress.value = receivedSize / expectedSize;
        // logic to reconstruct file
      };
    };

    peerConnection.onicecandidate = e => {
      if (e.candidate) {
        socket.emit('signal', { room: currentRoom, data: { candidate: e.candidate } });
        console.log("RECV: ICE candidate", e.candidate);
      }
    };

    socket.on('signal', async ({ data }) => {
      console.log("RECV: Received signal", data);
      if (data.sdp) {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.sdp));
        if (data.sdp.type === 'offer') {
          const answer = await peerConnection.createAnswer();
          await peerConnection.setLocalDescription(answer);
          socket.emit('signal', { room: currentRoom, data: { sdp: peerConnection.localDescription } });
        }
      } else if (data.candidate) {
        await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
        console.log("RECV: ICE candidate added");
      }
    });
  }
};


socket.on('new-participant', () => {
  // No action needed, sending starts when sender clicks Start Transfer
});

// AUTOMATIC RECEIVER MODE
window.onload = function() {
  const params = new URLSearchParams(window.location.search);
  if (params.has('room')) {
    currentRoom = params.get('room').toUpperCase();
    senderSection.classList.add('hidden');
    receiverSection.classList.remove('hidden');
    receiverStatus.innerText = "Waiting for sender to start sending…";
    socket.emit('join-room', currentRoom);

    peerConnection = new RTCPeerConnection();
    peerConnection.ondatachannel = ev => {
      dataChannel = ev.channel;
      receiveBuffer = [];
      receivedSize = 0;
      dataChannel.onmessage = event => {
        // Meta comes as JSON string first!
        if (typeof event.data === 'string' && event.data.includes('__meta')) {
          fileMeta = JSON.parse(event.data);
          expectedSize = fileMeta.size;
          fileNameSpan.textContent = fileMeta.name;
          fileTypeSpan.textContent = fileMeta.type;
          fileInfo.classList.remove('hidden');
          recvProgress.style.width = '0%';
          recvPercent.textContent = '0%';
          receiverStatus.innerText = `Receiving "${fileMeta.name}"…`;
          return;
        }
        // Otherwise, actual file data
        receiveBuffer.push(event.data);
        receivedSize += event.data.byteLength;
        const percent = ((receivedSize / expectedSize) * 100).toFixed(1);
        recvProgress.style.width = percent + '%';
        recvPercent.textContent = percent + '%';
        if (percent < 5 && receivedSize > 0) {
          recvProgress.style.width = '5%';
          recvPercent.textContent = '5%';
        }
        receiverStatus.innerText = `Downloading "${fileMeta.name}" (${percent}%)`;
      };
      dataChannel.onclose = () => {
        const blob = new Blob(receiveBuffer, { type: fileMeta.type });
        downloadLink.href = URL.createObjectURL(blob);
        downloadLink.download = fileMeta.name;
        downloadLink.classList.remove('hidden');
        receiverStatus.innerText = 'File ready! Click below to download.';
        recvProgress.style.width = '100%';
        recvPercent.textContent = '100%';
      };
    };

    peerConnection.onicecandidate = e => {
      if (e.candidate) socket.emit('signal', { room: currentRoom, data: { candidate: e.candidate } });
    };
  }
};
