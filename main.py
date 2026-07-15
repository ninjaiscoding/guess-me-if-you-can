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

class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        self.active_connections.remove(websocket)

    async def broadcast(self, message: dict, room_id: str):
        if room_id in rooms:
            for p in rooms[room_id]["players"]:
                if p["websocket"] in self.active_connections:
                    try:
                        # We need to send a personalized state so players don't see their own character
                        # but wait, it's easier to send the full state and let the client hide it,
                        # UNLESS they cheat by inspecting the network.
                        # For a casual game, hiding on client is fine, but server-side is safer.
                        state = get_room_state(room_id, p["id"])
                        await p["websocket"].send_json(state)
                    except Exception as e:
                        print(f"Error sending to {p['name']}: {e}")

manager = ConnectionManager()

def create_room(room_id: str):
    rooms[room_id] = {
        "id": room_id,
        "phase": "lobby",
        "category": "Anime Characters",
        "players": [], # {id, name, websocket, character, guessesLeft, isWinner, isLoser}
        "turnIndex": 0,
        "hostId": None
    }

def get_room_state(room_id: str, player_id: str):
    room = rooms[room_id]
    players_data = []
    for p in room["players"]:
        p_data = {
            "id": p["id"],
            "name": p["name"],
            "guessesLeft": p["guessesLeft"],
            "isWinner": p["isWinner"],
            "isLoser": p["isLoser"],
            "character": p["character"] if p["id"] != player_id or p["isWinner"] or p["isLoser"] or room["phase"] == "game_over" else "?"
        }
        players_data.append(p_data)
        
    return {
        "type": "game_state",
        "roomId": room["id"],
        "phase": room["phase"],
        "category": room["category"],
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
        return True
    return False

def advance_turn(room_id: str):
    room = rooms[room_id]
    if check_game_over(room_id):
        return
        
    # Find next active player
    start_index = room["turnIndex"]
    for i in range(1, len(room["players"]) + 1):
        idx = (start_index + i) % len(room["players"])
        p = room["players"][idx]
        if not p["isWinner"] and not p["isLoser"]:
            room["turnIndex"] = idx
            break

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    player_id = str(id(websocket))
    current_room = None
    
    try:
        while True:
            data = await websocket.receive_json()
            action = data.get("action")
            
            if action == "join":
                room_id = data.get("roomId", "default").upper()
                name = data.get("name", "Unknown")
                category = data.get("category", "Anime Characters")
                
                if room_id not in rooms:
                    create_room(room_id)
                    rooms[room_id]["hostId"] = player_id
                    rooms[room_id]["category"] = category
                
                # Check if game already started
                if rooms[room_id]["phase"] != "lobby":
                    await websocket.send_json({"type": "error", "message": "Game already in progress!"})
                    continue
                
                # Update category if host changes it
                if player_id == rooms[room_id]["hostId"] and "category" in data:
                    rooms[room_id]["category"] = category
                
                rooms[room_id]["players"].append({
                    "id": player_id,
                    "name": name,
                    "websocket": websocket,
                    "character": "",
                    "guessesLeft": 3,
                    "isWinner": False,
                    "isLoser": False
                })
                current_room = room_id
                await manager.broadcast({}, current_room)
                
            elif action == "update_category":
                if current_room and rooms[current_room]["hostId"] == player_id:
                    rooms[current_room]["category"] = data.get("category")
                    await manager.broadcast({}, current_room)

            elif action == "start_game":
                if current_room and rooms[current_room]["hostId"] == player_id:
                    room = rooms[current_room]
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
                    await manager.broadcast({}, current_room)
                    
            elif action == "make_guess":
                if current_room and rooms[current_room]["phase"] == "playing":
                    room = rooms[current_room]
                    guess = data.get("guess", "").strip().lower()
                    
                    # Find player
                    player = next((p for p in room["players"] if p["id"] == player_id), None)
                    if player and not player["isWinner"] and not player["isLoser"] and player["guessesLeft"] > 0:
                        correct = player["character"].lower() == guess
                        if correct:
                            player["isWinner"] = True
                        else:
                            player["guessesLeft"] -= 1
                            if player["guessesLeft"] == 0:
                                player["isLoser"] = True
                                
                        # If it's this player's turn and they won/lost, advance turn
                        if room["players"][room["turnIndex"]]["id"] == player_id:
                            advance_turn(current_room)
                        else:
                            check_game_over(current_room)
                            
                        await manager.broadcast({}, current_room)
                        
            elif action == "end_turn":
                if current_room and rooms[current_room]["phase"] == "playing":
                    room = rooms[current_room]
                    # Only allow current turn player to end turn
                    if room["players"][room["turnIndex"]]["id"] == player_id:
                        advance_turn(current_room)
                        await manager.broadcast({}, current_room)

            elif action == "play_again":
                if current_room and rooms[current_room]["hostId"] == player_id:
                    rooms[current_room]["phase"] = "lobby"
                    for p in rooms[current_room]["players"]:
                        p["character"] = ""
                        p["guessesLeft"] = 3
                        p["isWinner"] = False
                        p["isLoser"] = False
                    await manager.broadcast({}, current_room)

    except WebSocketDisconnect:
        manager.disconnect(websocket)
        if current_room and current_room in rooms:
            room = rooms[current_room]
            room["players"] = [p for p in room["players"] if p["id"] != player_id]
            if len(room["players"]) == 0:
                del rooms[current_room]
            else:
                if room["hostId"] == player_id:
                    room["hostId"] = room["players"][0]["id"]
                # Adjust turn if necessary
                if room["phase"] == "playing":
                    if room["turnIndex"] >= len(room["players"]):
                        room["turnIndex"] = 0
                    check_game_over(current_room)
                await manager.broadcast({}, current_room)

app.mount("/", StaticFiles(directory="public", html=True), name="public")

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=3000)
