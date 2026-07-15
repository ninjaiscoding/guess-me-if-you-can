import json
import random
import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from typing import Dict, List, Any
import asyncio

app = FastAPI()

# Load categories
with open("categories.json", "r") as f:
    CATEGORIES = json.load(f)

# Game state storage
rooms: Dict[str, Any] = {}
# Track room background tasks for timers
timer_tasks: Dict[str, asyncio.Task] = {}

class ConnectionManager:
    def __init__(self):
        # Map player session IDs to active WebSockets
        self.active_sockets: Dict[str, WebSocket] = {}

    async def connect(self, player_id: str, websocket: WebSocket):
        await websocket.accept()
        self.active_sockets[player_id] = websocket

    def disconnect(self, player_id: str):
        if player_id in self.active_sockets:
            del self.active_sockets[player_id]

    async def broadcast(self, room_id: str):
        if room_id in rooms:
            room = rooms[room_id]
            for p in room["players"]:
                ws = self.active_sockets.get(p["id"])
                if ws:
                    try:
                        state = get_room_state(room_id, p["id"])
                        await ws.send_json(state)
                    except Exception as e:
                        print(f"Error sending to {p['name']}: {e}")

manager = ConnectionManager()

def create_room(room_id: str):
    rooms[room_id] = {
        "id": room_id,
        "phase": "lobby", # lobby, writing, playing, game_over
        "category": "Anime Characters",
        "timerLimit": "none", # none, 60, 120
        "timerRemaining": None,
        "players": [], # {id, name, character, guessesLeft, isWinner, isLoser, online, customTargetId, customWordSubmitted}
        "turnIndex": 0,
        "hostId": None
    }

def get_room_state(room_id: str, player_id: str):
    room = rooms[room_id]
    players_data = []
    
    for p in room["players"]:
        show_char = (
            p["id"] != player_id or 
            p["isWinner"] or 
            p["isLoser"] or 
            room["phase"] == "game_over"
        )
        players_data.append({
            "id": p["id"],
            "name": p["name"],
            "guessesLeft": p["guessesLeft"],
            "isWinner": p["isWinner"],
            "isLoser": p["isLoser"],
            "online": p["id"] in manager.active_sockets,
            "character": p["character"] if show_char else "?",
            "customWordSubmitted": p.get("customWordSubmitted", False),
            "customTargetName": next((target["name"] for target in room["players"] if target["id"] == p.get("customTargetId")), "")
        })
        
    return {
        "type": "game_state",
        "roomId": room["id"],
        "phase": room["phase"],
        "category": room["category"],
        "timerLimit": room["timerLimit"],
        "timerRemaining": room["timerRemaining"],
        "players": players_data,
        "turnIndex": room["turnIndex"],
        "hostId": room["hostId"],
        "myId": player_id
    }

def check_game_over(room_id: str):
    room = rooms[room_id]
    active_players = [p for p in room["players"] if not p["isWinner"] and not p["isLoser"]]
    if len(active_players) <= 1 and len(room["players"]) > 1:
        if len(active_players) == 1:
            active_players[0]["isLoser"] = True
        room["phase"] = "game_over"
        stop_timer(room_id)
        return True
    return False

def advance_turn(room_id: str):
    room = rooms[room_id]
    if check_game_over(room_id):
        return
        
    start_index = room["turnIndex"]
    for i in range(1, len(room["players"]) + 1):
        idx = (start_index + i) % len(room["players"])
        p = room["players"][idx]
        if not p["isWinner"] and not p["isLoser"]:
            room["turnIndex"] = idx
            break
            
    start_timer(room_id)

def start_timer(room_id: str):
    stop_timer(room_id)
    room = rooms[room_id]
    if room["timerLimit"] == "none" or room["phase"] != "playing":
        room["timerRemaining"] = None
        return

    limit = int(room["timerLimit"])
    room["timerRemaining"] = limit

    async def countdown():
        try:
            while room["timerRemaining"] > 0:
                await asyncio.sleep(1)
                room["timerRemaining"] -= 1
                await manager.broadcast(room_id)
            advance_turn(room_id)
            await manager.broadcast(room_id)
        except asyncio.CancelledError:
            pass

    timer_tasks[room_id] = asyncio.create_task(countdown())

def stop_timer(room_id: str):
    if room_id in timer_tasks:
        timer_tasks[room_id].cancel()
        del timer_tasks[room_id]
    if room_id in rooms:
        rooms[room_id]["timerRemaining"] = None

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    player_id = None
    current_room = None
    
    try:
        while True:
            data = await websocket.receive_json()
            action = data.get("action")
            
            if action == "join":
                player_id = data.get("playerId")
                room_id = data.get("roomId", "").strip().upper()
                name = data.get("name", "Unknown")
                category = data.get("category", "Anime Characters")
                timer_limit = data.get("timerLimit", "none")
                is_creating = data.get("isCreating", False)
                
                if not player_id or not room_id:
                    continue
                
                manager.active_sockets[player_id] = websocket
                
                # Strict check preventing cross-contamination of missing rooms
                if room_id not in rooms:
                    if is_creating:
                        create_room(room_id)
                        rooms[room_id]["hostId"] = player_id
                        rooms[room_id]["category"] = category
                        rooms[room_id]["timerLimit"] = timer_limit
                    else:
                        await websocket.send_json({
                            "type": "error", 
                            "message": f"Room '{room_id}' does not exist! Please check the spelling or create it."
                        })
                        manager.disconnect(player_id)
                        continue
                
                room = rooms[room_id]
                current_room = room_id
                
                existing_player = next((p for p in room["players"] if p["id"] == player_id), None)
                
                if existing_player:
                    existing_player["name"] = name  
                else:
                    if room["phase"] != "lobby":
                        await websocket.send_json({"type": "error", "message": "Game already in progress!"})
                        manager.disconnect(player_id)
                        return
                    
                    room["players"].append({
                        "id": player_id,
                        "name": name,
                        "character": "",
                        "guessesLeft": 3,
                        "isWinner": False,
                        "isLoser": False,
                        "customTargetId": None,
                        "customWordSubmitted": False
                    })
                
                await manager.broadcast(current_room)
                
            elif action == "update_lobby_settings":
                if current_room and rooms[current_room]["hostId"] == player_id:
                    rooms[current_room]["category"] = data.get("category")
                    rooms[current_room]["timerLimit"] = data.get("timerLimit")
                    await manager.broadcast(current_room)

            elif action == "start_game":
                if current_room and rooms[current_room]["hostId"] == player_id:
                    room = rooms[current_room]
                    
                    if room["category"] == "Custom Words":
                        num_players = len(room["players"])
                        for i, p in enumerate(room["players"]):
                            target_index = (i + 1) % num_players
                            p["customTargetId"] = room["players"][target_index]["id"]
                            p["customWordSubmitted"] = False
                            p["character"] = ""
                        room["phase"] = "writing"
                    else:
                        cat = room["category"]
                        if cat not in CATEGORIES:
                            cat = list(CATEGORIES.keys())[0]
                        
                        chars = CATEGORIES[cat].copy()
                        random.shuffle(chars)
                        
                        for i, p in enumerate(room["players"]):
                            p["character"] = chars[i % len(chars)]
                            p["guessesLeft"] = 3
                            p["isWinner"] = False
                            p["isLoser"] = False
                            
                        room["phase"] = "playing"
                        room["turnIndex"] = 0
                        start_timer(current_room)
                        
                    await manager.broadcast(current_room)

            elif action == "submit_custom_word":
                if current_room and rooms[current_room]["phase"] == "writing":
                    room = rooms[current_room]
                    custom_word = data.get("word", "").strip()
                    
                    me = next((p for p in room["players"] if p["id"] == player_id), None)
                    if me and not me["customWordSubmitted"] and custom_word:
                        target_player = next((p for p in room["players"] if p["id"] == me["customTargetId"]), None)
                        if target_player:
                            target_player["character"] = custom_word
                            me["customWordSubmitted"] = True
                            
                    all_submitted = all(p.get("customWordSubmitted", False) for p in room["players"])
                    if all_submitted:
                        for p in room["players"]:
                            p["guessesLeft"] = 3
                            p["isWinner"] = False
                            p["isLoser"] = False
                        room["phase"] = "playing"
                        room["turnIndex"] = 0
                        start_timer(current_room)
                        
                    await manager.broadcast(current_room)
                    
            elif action == "make_guess":
                if current_room and rooms[current_room]["phase"] == "playing":
                    room = rooms[current_room]
                    guess = data.get("guess", "").strip().lower()
                    
                    player = next((p for p in room["players"] if p["id"] == player_id), None)
                    if player and not player["isWinner"] and not player["isLoser"] and player["guessesLeft"] > 0:
                        correct = player["character"].lower() == guess
                        if correct:
                            player["isWinner"] = True
                        else:
                            player["guessesLeft"] -= 1
                            if player["guessesLeft"] == 0:
                                player["isLoser"] = True
                                
                        if room["players"][room["turnIndex"]]["id"] == player_id:
                            advance_turn(current_room)
                        else:
                            check_game_over(current_room)
                            
                        await manager.broadcast(current_room)
                        
            elif action == "end_turn":
                if current_room and rooms[current_room]["phase"] == "playing":
                    room = rooms[current_room]
                    if room["players"][room["turnIndex"]]["id"] == player_id:
                        advance_turn(current_room)
                        await manager.broadcast(current_room)

            elif action == "back_to_lobby":
                if current_room and rooms[current_room]["hostId"] == player_id:
                    room = rooms[current_room]
                    stop_timer(current_room)
                    room["phase"] = "lobby"
                    for p in room["players"]:
                        p["character"] = ""
                        p["guessesLeft"] = 3
                        p["isWinner"] = False
                        p["isLoser"] = False
                        p["customTargetId"] = None
                        p["customWordSubmitted"] = False
                    await manager.broadcast(current_room)

            elif action == "leave":
                if current_room and current_room in rooms:
                    room = rooms[current_room]
                    room["players"] = [p for p in room["players"] if p["id"] != player_id]
                    manager.disconnect(player_id)
                    
                    if len(room["players"]) == 0:
                        stop_timer(current_room)
                        del rooms[current_room]
                    else:
                        if room["hostId"] == player_id:
                            room["hostId"] = room["players"][0]["id"]
                        if room["phase"] == "playing":
                            if room["turnIndex"] >= len(room["players"]):
                                room["turnIndex"] = 0
                            check_game_over(current_room)
                        await manager.broadcast(current_room)
                    break

    except WebSocketDisconnect:
        manager.disconnect(player_id)
        if current_room and current_room in rooms:
            await manager.broadcast(current_room)

app.mount("/", StaticFiles(directory="public", html=True), name="public")

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=3000)
