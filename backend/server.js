const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Serve static files from 'frontend' directory
app.use(express.static(path.join(__dirname, 'frontend')));

// Fallback: send index.html on all unknown routes (for SPA/pages without extension)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend', 'index.html'));
});

// Socket.io routes & logic
io.on('connection', (socket) => {
  // ... (your socket.io logic unchanged)
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('Server running on port', PORT));
