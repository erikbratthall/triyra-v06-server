const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server,{cors:{origin:"*"}});

const rooms = {};

io.on("connection", (socket) => {
  socket.on("createRoom", ({ rows = 6 }) => {
    const roomCode = Math.random().toString(36).substring(2,5).toUpperCase();
    rooms[roomCode] = { players: { p1: socket.id, p2: null }};
    socket.join(roomCode);
    socket.emit("roomCreated",{roomCode});
  });

  socket.on("joinRoom", ({ roomCode }) => {
    const room = rooms[roomCode];
    if(!room){socket.emit("errorMessage",{message:"Room not found"});return;}
    room.players.p2 = socket.id;
    socket.join(roomCode);
    io.to(roomCode).emit("gameReady");
  });
});

app.get("/",(req,res)=>res.send("Triyra v0.6 server running"));

server.listen(3000);
