const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.static('frontend'));

io.on('connection', (socket) => {
  socket.on('join-room', (room) => {
    socket.join(room);
    socket.to(room).emit('new-participant', socket.id);
  });

  socket.on('signal', ({ room, data }) => {
    socket.to(room).emit('signal', { from: socket.id, data });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Signaling server running on port ${PORT}`);
});
