const socket = io('https://sharecloud-1.onrender.com');
let peerConnection, dataChannel, fileReader, currentRoom;
let receiveBuffer = [], receivedSize = 0, chunkSize = 128 * 1024, expectedSize = 0, fileMeta = {};
const fileInput = document.getElementById('fileInput');
const fileLabel = document.getElementById('fileLabel');
const senderSection = document.getElementById('senderSection');
const receiverSection = document.getElementById('receiverSection');
const receiverStatus = document.getElementById('receiverStatus');
const downloadLink = document.getElementById('downloadLink');
const recvProgress = document.getElementById('recvProgress');
const recvPercent = document.getElementById('recvPercent');
const fileInfo = document.getElementById('fileInfo');
const fileNameSpan = document.getElementById('fileName');
const fileTypeSpan = document.getElementById('fileType');
const sendProgress = document.getElementById('sendProgress');
const sendPercent = document.getElementById('sendPercent');
const sendFileInfo = document.getElementById('sendFileInfo');
const sendFileName = document.getElementById('sendFileName');
const sendFileType = document.getElementById('sendFileType');

fileInput.addEventListener('change', () => {
  fileLabel.innerText = fileInput.files[0] ? fileInput.files[0].name : "Select, or drag & drop file";
});

// Generate sharing link before selecting file
function generateShareLink() {
  currentRoom = Math.random().toString(36).substring(2, 8).toUpperCase();
  const link = `${window.location.origin}?room=${currentRoom}`;
  document.getElementById('shareArea').innerHTML = `
    <span class="block mb-2">Share this link:</span>
    <input type="text" readonly class="p-2 rounded w-full bg-blue-100 font-mono mb-2" value="${link}">
    <button onclick="navigator.clipboard.writeText('${link}')" class="px-4 py-2 bg-blue-200 rounded hover:bg-blue-300">Copy Link</button>
    <div class="mt-6">
      <input id="fileInput" class="block my-4" type="file" />
      <button onclick="sendFile()" class="block px-4 py-2 bg-blue-500 rounded text-white">Start Transfer</button>
      <span id="fileLabel" class="ml-3 text-blue-700"></span>
    </div>
  `;
  socket.emit('join-room', currentRoom);

  document.getElementById('fileInput').addEventListener('change', (e) => {
    document.getElementById('fileLabel').innerText = e.target.files[0] ? e.target.files[0].name : "Select file";
  });
}

window.sendFile = function sendFile() {
  const fileInputElem = document.getElementById('fileInput');
  if (!fileInputElem.files.length) {
    alert('Select a file first!');
    return;
  }
  const file = fileInputElem.files[0];

  sendFileName.textContent = file.name;
  sendFileType.textContent = file.type;
  sendFileInfo.classList.remove('hidden');
  let sentBytes = 0;

  fileMeta = {
    name: file.name,
    size: file.size,
    type: file.type
  };

  peerConnection = new RTCPeerConnection();
  dataChannel = peerConnection.createDataChannel('fileTransfer');
  dataChannel.binaryType = 'arraybuffer';

  dataChannel.onopen = () => {
    // Send file meta as JSON
    dataChannel.send(JSON.stringify({ __meta: true, ...fileMeta }));
    let offset = 0;
    fileReader = new FileReader();
    fileReader.onload = e => {
      dataChannel.send(e.target.result);
      offset += e.target.result.byteLength;
      sentBytes += e.target.result.byteLength;
      // Progress bar update
      const percent = ((sentBytes / file.size) * 100).toFixed(1);
      sendProgress.style.width = percent + '%';
      sendPercent.textContent = percent + '%';
      if (percent < 5 && sentBytes > 0) {
        sendProgress.style.width = '5%';
        sendPercent.textContent = '5%';
      }
      if (offset < file.size) readSlice(offset);
      else {
        sendProgress.style.width = '100%';
        sendPercent.textContent = '100%';
        dataChannel.close();
      }
    };
    function readSlice(o) {
      const slice = file.slice(offset, o + chunkSize);
      fileReader.readAsArrayBuffer(slice);
    }
    readSlice(0);
  };
  dataChannel.onclose = () => {};

  peerConnection.onicecandidate = e => {
    if (e.candidate) socket.emit('signal', { room: currentRoom, data: { candidate: e.candidate } });
  };

  peerConnection.createOffer().then(offer => {
    return peerConnection.setLocalDescription(offer);
  }).then(() => {
    socket.emit('signal', { room: currentRoom, data: { sdp: peerConnection.localDescription } });
  });
};

socket.on('signal', async ({ data }) => {
  if (!peerConnection || !data) return;
  if (data.sdp) {
    await peerConnection.setRemoteDescription(new RTCSessionDescription(data.sdp));
    if (data.sdp.type === 'offer') {
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);
      socket.emit('signal', { room: currentRoom, data: { sdp: peerConnection.localDescription } });
    }
  } else if (data.candidate) {
    try { await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate)); }
    catch (e) {}
  }
});

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
