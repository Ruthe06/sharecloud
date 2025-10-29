const express = require('express');
const http = require('http');
const path = require('path');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);
const rooms = {};

io.on('connection', socket => {
  socket.on('join-room', room => {
    socket.join(room);
    if (!rooms[room]) rooms[room] = [];
    rooms[room].push(socket.id);
    // Notify sender/receiver if needed
  });

  socket.on('signal', ({ room, data }) => {
    // Relay to others in room
    socket.to(room).emit('signal', { data });
  });

  socket.on('disconnect', () => {
    // Clean up rooms on disconnect
    Object.keys(rooms).forEach(room => {
      rooms[room] = rooms[room].filter(id => id !== socket.id);
      if (rooms[room].length === 0) delete rooms[room];
    });
  });
});
app.use(express.static(path.join(__dirname, 'frontend')));

// Fallback route
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'frontend', 'index.html'));
});

io.on('connection', socket => {
  // your socket.io handlers
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('Server running on port', PORT));
