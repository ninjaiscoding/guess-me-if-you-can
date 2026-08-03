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
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, room_id: str):
        if room_id in rooms:
            room = rooms[room_id]
            for p in room["players"]:
                if p["websocket"] and p["websocket"] in self.active_connections:
                    try:
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
        "timerOption": "120",  # "120", "240"
        "customWordsEnabled": False,
        "players": [], # {id, name, websocket, character, guessesLeft, isWinner, isLoser, customWordGiven, isDisconnected}
        "turnIndex": 0,
        "hostId": None,
        "timerRemaining": 120,
        "timerTask": None
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
            "isDisconnected": p["isDisconnected"],
            "customWordGiven": p.get("customWordGiven", ""),
            "character": p["character"] if p["id"] != player_id or p["isWinner"] or p["isLoser"] or room["phase"] == "game_over" else "?"
        }
        players_data.append(p_data)
        
    return {
        "type": "game_state",
        "roomId": room["id"],
        "phase": room["phase"],
        "category": room["category"],
        "timerOption": room["timerOption"],
        "customWordsEnabled": room["customWordsEnabled"],
        "players": players_data,
        "turnIndex": room["turnIndex"],
        "hostId": room["hostId"],
        "myId": player_id,
        "timerRemaining": room["timerRemaining"]
    }

def check_game_over(room_id: str):
    room = rooms[room_id]
    # Active means still trying to guess
    active_players = [p for p in room["players"] if not p["isWinner"] and not p["isLoser"]]
    if len(active_players) <= 1 and len(room["players"]) > 1:
        if len(active_players) == 1:
            active_players[0]["isLoser"] = True
        room["phase"] = "game_over"
        stop_room_timer(room)
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
            
    # Restart timer for the next player turn
    start_room_timer(room_id)

def start_room_timer(room_id: str):
    room = rooms[room_id]
    stop_room_timer(room)
    
    room["timerRemaining"] = int(room["timerOption"])
    
    async def timer_loop():
        try:
            while room["timerRemaining"] > 0 and room["phase"] == "playing":
                await asyncio.sleep(1)
                room["timerRemaining"] -= 1
                await manager.broadcast(room_id)
            
            if room["phase"] == "playing" and room["timerRemaining"] <= 0:
                # Time ran out, advance turn automatically
                advance_turn(room_id)
                await manager.broadcast(room_id)
        except asyncio.CancelledError:
            pass

    room["timerTask"] = asyncio.create_task(timer_loop())

def stop_room_timer(room):
    if room.get("timerTask") and not room["timerTask"].done():
        room["timerTask"].cancel()
    room["timerTask"] = None

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    player_id = None
    current_room = None
    
    try:
        while True:
            data = await websocket.receive_json()
            action = data.get("action")
            
            if action == "join":
                room_id = data.get("roomId", "default").upper()
                name = data.get("name", "Unknown").strip()
                category = data.get("category", "Anime Characters")
                timer_opt = data.get("timerOption", "120")
                custom_words = data.get("customWordsEnabled", False)
                
                calculated_id = f"{room_id}_{name.lower()}"
                player_id = calculated_id
                current_room = room_id
                
                if room_id not in rooms:
                    create_room(room_id)
                    rooms[room_id]["hostId"] = player_id
                    rooms[room_id]["category"] = category
                    rooms[room_id]["timerOption"] = timer_opt
                    rooms[room_id]["customWordsEnabled"] = custom_words
                
                room = rooms[room_id]
                existing_player = next((p for p in room["players"] if p["id"] == player_id), None)
                
                if existing_player:
                    existing_player["websocket"] = websocket
                    existing_player["isDisconnected"] = False
                else:
                    if room["phase"] != "lobby":
                        await websocket.send_json({"type": "error", "message": "Game already in progress!"})
                        player_id = None
                        current_room = None
                        continue
                        
                    room["players"].append({
                        "id": player_id,
                        "name": name,
                        "websocket": websocket,
                        "character": "",
                        "guessesLeft": 3,
                        "isWinner": False,
                        "isLoser": False,
                        "customWordGiven": "",
                        "isDisconnected": False
                    })
                
                await manager.broadcast(current_room)

            elif action == "kick":
                if current_room and rooms[current_room]["hostId"] == player_id:
                    target_id = data.get("playerId")
                    room = rooms[current_room]
                    
                    target_player = next((p for p in room["players"] if p["id"] == target_id), None)
                    if target_player:
                        # 1. Send kicked signal to target client before closing
                        if target_player["websocket"] and target_player["websocket"] in manager.active_connections:
                            try:
                                await target_player["websocket"].send_json({
                                    "type": "kicked", 
                                    "message": "You have been kicked from the room by the host."
                                })
                                await target_player["websocket"].close()
                            except Exception as e:
                                print(f"Error kicking player: {e}")
                            manager.disconnect(target_player["websocket"])
                        
                        # 2. Filter them out of the list
                        room["players"] = [p for p in room["players"] if p["id"] != target_id]
                        
                        # 3. Handle game progression updates if they were kicked during play
                        if room["phase"] == "playing":
                            if room["turnIndex"] >= len(room["players"]):
                                room["turnIndex"] = 0
                            check_game_over(current_room)
                            
                        await manager.broadcast(current_room)
                
            elif action == "update_lobby_settings":
                if current_room and rooms[current_room]["hostId"] == player_id:
                    room = rooms[current_room]
                    room["category"] = data.get("category", room["category"])
                    room["timerOption"] = data.get("timerOption", room["timerOption"])
                    room["customWordsEnabled"] = data.get("customWordsEnabled", room["customWordsEnabled"])
                    await manager.broadcast(current_room)

            elif action == "start_game":
                if current_room and rooms[current_room]["hostId"] == player_id:
                    room = rooms[current_room]
                    
                    if room["customWordsEnabled"]:
                        room["phase"] = "custom_words_assign"
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
                        start_room_timer(current_room)
                        
                    await manager.broadcast(current_room)

            elif action == "submit_custom_word":
                if current_room and rooms[current_room]["phase"] == "custom_words_assign":
                    room = rooms[current_room]
                    word = data.get("word", "").strip()
                    
                    player = next((p for p in room["players"] if p["id"] == player_id), None)
                    if player and word:
                        player["customWordGiven"] = word
                        
                    if all(p["customWordGiven"] != "" for p in room["players"]):
                        words = [p["customWordGiven"] for p in room["players"]]
                        random.shuffle(words)
                        
                        for i in range(len(room["players"])):
                            target_player = room["players"][i]
                            word_to_assign = words[i]
                            
                            if len(room["players"]) > 1 and target_player["customWordGiven"] == word_to_assign:
                                swap_idx = (i + 1) % len(room["players"])
                                words[i], words[swap_idx] = words[swap_idx], words[i]
                                word_to_assign = words[i]
                                
                            target_player["character"] = word_to_assign
                            target_player["guessesLeft"] = 3
                            target_player["isWinner"] = False
                            target_player["isLoser"] = False
                            
                        room["phase"] = "playing"
                        room["turnIndex"] = 0
                        start_room_timer(current_room)
                        
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
                    stop_room_timer(room)
                    room["phase"] = "lobby"
                    for p in room["players"]:
                        p["character"] = ""
                        p["guessesLeft"] = 3
                        p["isWinner"] = False
                        p["isLoser"] = False
                        p["customWordGiven"] = ""
                    await manager.broadcast(current_room)

            elif action == "leave_game":
                if current_room and current_room in rooms:
                    room = rooms[current_room]
                    room["players"] = [p for p in room["players"] if p["id"] != player_id]
                    
                    if len(room["players"]) == 0:
                        stop_room_timer(room)
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

            elif action == "play_again":
                if current_room and rooms[current_room]["hostId"] == player_id:
                    room = rooms[current_room]
                    stop_room_timer(room)
                    room["phase"] = "lobby"
                    for p in room["players"]:
                        p["character"] = ""
                        p["guessesLeft"] = 3
                        p["isWinner"] = False
                        p["isLoser"] = False
                        p["customWordGiven"] = ""
                    await manager.broadcast(current_room)
                    
    except WebSocketDisconnect:
        manager.disconnect(websocket)
        if current_room and current_room in rooms:
            room = rooms[current_room]
            player = next((p for p in room["players"] if p["id"] == player_id), None)
            if player:
                player["isDisconnected"] = True
                player["websocket"] = None
            await manager.broadcast(current_room)

app.mount("/", StaticFiles(directory="public", html=True), name="public")

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=3000)
