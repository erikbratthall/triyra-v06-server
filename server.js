const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const rooms = {};
const LEADERBOARD_FILE = path.join(__dirname, "leaderboard.json");

function loadLeaderboard() {
  try { return JSON.parse(fs.readFileSync(LEADERBOARD_FILE, "utf8")); }
  catch { return {}; }
}
function saveLeaderboard(data) {
  fs.writeFileSync(LEADERBOARD_FILE, JSON.stringify(data, null, 2));
}
function updateLeaderboard(date, name, score) {
  const data = loadLeaderboard();
  if (!data[date]) data[date] = [];
  data[date].push({ name, score, ts: Date.now() });
  data[date].sort((a,b) => b.score - a.score || a.ts - b.ts);
  data[date] = data[date].slice(0,3);
  saveLeaderboard(data);
  return data[date];
}
app.get("/leaderboard", (req, res) => {
  const date = String(req.query.date || "");
  const data = loadLeaderboard();
  res.json({ entries: data[date] || [] });
});
app.post("/leaderboard", (req, res) => {
  const date = String(req.body.date || "");
  const name = String(req.body.name || "Player").slice(0,24);
  const score = Number(req.body.score || 0);
  if (!date) return res.status(400).json({ error: "date required" });
  const entries = updateLeaderboard(date, name, score);
  res.json({ entries });
});

function edgeKey(a,b){ return a < b ? `${a}-${b}` : `${b}-${a}`; }
function pointIndex(row,col){ return (row*(row+1))/2 + col; }
function buildGeometry(rows){ const triangles=[]; const edges=new Set(); const addEdge=(a,b)=>edges.add(edgeKey(a,b)); for(let row=0;row<rows;row++){ for(let col=0;col<=row;col++){ const a=pointIndex(row,col); if(col<row) addEdge(a, pointIndex(row,col+1)); if(row<rows-1){ addEdge(a, pointIndex(row+1,col)); addEdge(a, pointIndex(row+1,col+1)); } } } for(let row=0;row<rows-1;row++){ for(let col=0;col<=row;col++){ const a=pointIndex(row,col), b=pointIndex(row+1,col), c=pointIndex(row+1,col+1); triangles.push({id:`down-${row}-${col}`, edges:[edgeKey(a,b),edgeKey(b,c),edgeKey(a,c)], row:row*2, column:col*2}); } } for(let row=1;row<rows-1;row++){ for(let col=0;col<row;col++){ const a=pointIndex(row,col), b=pointIndex(row,col+1), c=pointIndex(row+1,col+1); triangles.push({id:`up-${row}-${col}`, edges:[edgeKey(a,b),edgeKey(a,c),edgeKey(b,c)], row:row*2-1, column:col*2+1}); } } return {edges:Array.from(edges), triangles}; }
const ROOM_WORDS=["SUN","FOX","OWL","MAP","BEE","RED","SKY","OAK","ICE","GEM","WAVE","FIR","ANT","ASH","BAY","CUP","DOT","ELM","FIG","GAS","HEN","IVY","JET","KEY","LOG","MINT","NUT","ORB","PEN","RIM","SAGE","TIN","URN","VAN","WAX","YAK","ZAP","ACE","ARC","ARM","ART","AWE","AXE","BAR","BAT","BOW","BOX","CAN","CAT","COB","COW","DAY","DEW","DRY","EEL","EGG","FAN","FIN","GAP","HAT","HOP","INK","JAM","LID","LIP","MUG","NET","PIT","POD","RUG","SEA","SEED","SHIP","STAR","TREE","WIND","WOLF"];
function createRoomCode(){ return ROOM_WORDS[Math.floor(Math.random()*ROOM_WORDS.length)]; }
function pickGoldTriangles(triangles){ const count=Math.floor(Math.random()*5)+2; const shuffled=[...triangles].sort(()=>Math.random()-0.5); return shuffled.slice(0, Math.min(count, shuffled.length)).map(t=>t.id); }
function buildAdjacency(triangles){ const map={}; for(const tri of triangles) map[tri.id]=[]; for(let i=0;i<triangles.length;i++) for(let j=i+1;j<triangles.length;j++){ const overlap=triangles[i].edges.filter(e=>triangles[j].edges.includes(e)).length; if(overlap>=1){ map[triangles[i].id].push(triangles[j].id); map[triangles[j].id].push(triangles[i].id); } } return map; }
function createInitialState(rows=6){ const geometry=buildGeometry(rows), goldTriangles=pickGoldTriangles(geometry.triangles); return { rows, edges:geometry.edges, triangles:geometry.triangles, adjacency:buildAdjacency(geometry.triangles), goldTriangles, drawnEdges:[], edgeOwners:{}, claimedTriangles:{}, player1Score:0, player2Score:0, currentTurn:'player1', winner:null, bonusFlags:{threeRowAwarded_player:false, threeRowAwarded_opponent:false, clusterAwarded_player:false, clusterAwarded_opponent:false} }; }
function ownedTriangles(state, owner){ return state.triangles.filter(t=>state.claimedTriangles[t.id]===owner); }
function hasThreeInRow(state, owner){ const rows={}; for(const tri of ownedTriangles(state, owner)){ if(!rows[tri.row]) rows[tri.row]=[]; rows[tri.row].push(tri.column); } for(const cols of Object.values(rows)){ const set=new Set(cols); for(const col of set){ if(set.has(col+2)&&set.has(col+4)) return true; } } return false; }
function largestCluster(state, owner){ const ownedIds=new Set(ownedTriangles(state, owner).map(t=>t.id)); const seen=new Set(); let best=0; for(const id of ownedIds){ if(seen.has(id)) continue; let size=0; const stack=[id]; seen.add(id); while(stack.length){ const cur=stack.pop(); size++; for(const n of state.adjacency[cur]||[]){ if(ownedIds.has(n)&&!seen.has(n)){ seen.add(n); stack.push(n); } } } best=Math.max(best,size);} return best; }
function applyBonuses(state, owner){ const isP1=owner==='player1'; const threeKey=isP1?'threeRowAwarded_player':'threeRowAwarded_opponent'; const clusterKey=isP1?'clusterAwarded_player':'clusterAwarded_opponent'; if(hasThreeInRow(state, owner)&&!state.bonusFlags[threeKey]){ state.bonusFlags[threeKey]=true; if(isP1) state.player1Score+=3; else state.player2Score+=3; } if(largestCluster(state, owner)>=4&&!state.bonusFlags[clusterKey]){ state.bonusFlags[clusterKey]=true; if(isP1) state.player1Score+=2; else state.player2Score+=2; } }
function applyMove(state, owner, edge){ if(state.winner) return {ok:false,message:'Game over.'}; if(state.drawnEdges.includes(edge)) return {ok:false,message:'Line already taken.'}; if(state.currentTurn!==owner) return {ok:false,message:'Not your turn.'}; state.drawnEdges.push(edge); state.edgeOwners[edge]=owner; const newlyClosed=state.triangles.filter(tri=>!state.claimedTriangles[tri.id]&&tri.edges.includes(edge)&&tri.edges.every(e=>e===edge||state.drawnEdges.includes(e))); if(newlyClosed.length){ for(const tri of newlyClosed){ state.claimedTriangles[tri.id]=owner; const points=state.goldTriangles.includes(tri.id)?10:2; if(owner==='player1') state.player1Score+=points; else state.player2Score+=points; } applyBonuses(state, owner); } else state.currentTurn=owner==='player1'?'player2':'player1'; if(state.drawnEdges.length===state.edges.length){ if(state.player1Score>state.player2Score) state.winner='player1'; else if(state.player2Score>state.player1Score) state.winner='player2'; else state.winner='draw'; } return {ok:true}; }

io.on('connection', socket=>{
  socket.on('createRoom', ({rows=6, playerName='Player'})=>{
    let roomCode; do roomCode=createRoomCode(); while(rooms[roomCode]);
    rooms[roomCode]={players:{player1:socket.id,player2:null}, names:{player1:String(playerName).slice(0,24), player2:null}, state:createInitialState(rows)};
    socket.join(roomCode);
    socket.emit('roomCreated', {roomCode, role:'player1', config:{rows}, player1Name: rooms[roomCode].names.player1});
  });

  socket.on('joinRoom', ({roomCode, playerName='Player'})=>{
    roomCode=String(roomCode||'').toUpperCase();
    const room=rooms[roomCode];
    if(!room) return socket.emit('errorMessage', {message:'Room not found.'});
    if(room.players.player2) return socket.emit('errorMessage', {message:'Room is full.'});
    room.players.player2=socket.id;
    room.names.player2 = String(playerName).slice(0,24);
    socket.join(roomCode);
    socket.emit('roomJoined', {roomCode, role:'player2', config:{rows:room.state.rows}, player1Name: room.names.player1, player2Name: room.names.player2});
    io.to(roomCode).emit('gameReady', {roomCode, state:room.state, player1Name: room.names.player1, player2Name: room.names.player2});
  });

  socket.on('makeMove', ({roomCode,edge})=>{
    const room=rooms[roomCode];
    if(!room) return;
    let role=null;
    if(room.players.player1===socket.id) role='player1';
    if(room.players.player2===socket.id) role='player2';
    if(!role) return;
    const result=applyMove(room.state, role, edge);
    if(!result.ok) return socket.emit('invalidMove', {message:result.message||'Invalid move.'});
    io.to(roomCode).emit('stateSync', {state:room.state, player1Name: room.names.player1, player2Name: room.names.player2});
  });

  socket.on('disconnect', ()=>{
    for(const [roomCode,room] of Object.entries(rooms)){
      if(room.players.player1===socket.id || room.players.player2===socket.id){
        io.to(roomCode).emit('playerLeft');
        delete rooms[roomCode];
      }
    }
  });
});

app.get('/', (req,res)=>res.send('Triyra v0.6 live server is running.'));
const PORT=process.env.PORT||3000;
server.listen(PORT, ()=>console.log(`Server running on port ${PORT}`));
