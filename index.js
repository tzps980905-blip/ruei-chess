const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname));

let db = { visits: 0, players: {} };
if (fs.existsSync('db.json')) {
    try { db = JSON.parse(fs.readFileSync('db.json')); } catch(e) {}
}
function saveDB() { fs.writeFileSync('db.json', JSON.stringify(db)); }

let rooms = {};

io.on('connection', (socket) => {
    db.visits++; saveDB();
    
    socket.on('joinRoom', ({ roomId, name, uuid }) => {
        if (!db.players[uuid]) db.players[uuid] = { name, score: 1000 };
        if (!rooms[roomId]) {
            rooms[roomId] = {
                id: roomId, players: {}, 
                board: Array(7).fill(null).map(() => Array(7).fill(null)),
                phase: 'waiting', turnResult: null, winner: null
            };
            // 初始佈陣
            for(let i=1; i<6; i++) { rooms[roomId].board[i][1] = 'p1'; rooms[roomId].board[i][5] = 'p2'; }
        }
        const room = rooms[roomId];
        if (Object.keys(room.players).length < 2) {
            const role = Object.keys(room.players).length === 0 ? 'p1' : 'p2';
            room.players[socket.id] = { role, name, uuid, rps: null, limitDir: null };
            socket.join(roomId);
            socket.emit('assignedRole', role);
            if (Object.keys(room.players).length === 2) room.phase = 'rps';
            io.to(roomId).emit('gameState', room);
        }
    });

    socket.on('submitAction', ({ roomId, rps, limitDir }) => {
        const room = rooms[roomId];
        if (!room || room.winner) return;
        const p = room.players[socket.id];
        p.rps = rps; p.limitDir = limitDir;

        const pIds = Object.keys(room.players);
        if (pIds.every(id => room.players[id].rps)) {
            const p1 = room.players[pIds.find(id => room.players[id].role === 'p1')];
            const p2 = room.players[pIds.find(id => room.players[id].role === 'p2')];
            const winnerRole = judgeRPS(p1.rps, p2.rps); 
            room.turnResult = { winnerRole, p1Forbidden: p2.limitDir, p2Forbidden: p1.limitDir };
            room.phase = winnerRole === 'tie' ? 'rps' : 'move_winner'; 
            if(winnerRole === 'tie') Object.values(room.players).forEach(pl => { pl.rps = null; pl.limitDir = null; });
            io.to(roomId).emit('gameState', room);
        }
    });

    socket.on('movePiece', ({ roomId, from, to }) => {
        const room = rooms[roomId];
        if (!room || room.winner) return;
        const p = room.players[socket.id];
        const isWinnerTurn = (room.phase === 'move_winner' && p.role === room.turnResult.winnerRole);
        const isLoserTurn = (room.phase === 'move_loser' && p.role !== room.turnResult.winnerRole);

        if (isWinnerTurn || isLoserTurn) {
            // 核心邏輯：只要目標不是自己的棋子，且在鄰格，即可移動/吃子
            if (room.board[from.r][from.c] === p.role && room.board[to.r][to.c] !== p.role) {
                room.board[from.r][from.c] = null;
                room.board[to.r][to.c] = p.role; // 覆蓋目標（即吃子）
                checkWin(room);
                if (!room.winner) {
                    if (room.phase === 'move_winner') room.phase = 'move_loser';
                    else {
                        room.phase = 'rps';
                        Object.values(room.players).forEach(pl => { pl.rps = null; pl.limitDir = null; });
                    }
                }
                io.to(roomId).emit('gameState', room);
            }
        }
    });
});

function judgeRPS(a, b) {
    if (a === b) return 'tie';
    if ((a==='rock' && b==='scissors') || (a==='paper' && b==='rock') || (a==='scissors' && b==='paper')) return 'p1';
    return 'p2';
}

function checkWin(room) {
    let p1 = 0, p2 = 0;
    room.board.forEach(row => row.forEach(c => { if(c==='p1') p1++; if(c==='p2') p2++; }));
    if (p1 === 0) room.winner = 'p2'; if (p2 === 0) room.winner = 'p1';
}

server.listen(3000);