const loginScreen = document.getElementById('login-screen');
const lobbyScreen = document.getElementById('lobby-screen');
const gameScreen = document.getElementById('game-screen');

// Login Elements
const playerNameInput = document.getElementById('player-name');
const roomIdInput = document.getElementById('roomId'); // wait id in html was room-id
const joinBtn = document.getElementById('join-btn');
const errorMsg = document.getElementById('login-error');
const categorySelect = document.getElementById('category-select');

// Lobby Elements
const displayRoomId = document.getElementById('display-room-id');
const displayCategory = document.getElementById('display-category');
const playersList = document.getElementById('lobby-players-list');
const hostControls = document.getElementById('host-controls');
const lobbyCategorySelect = document.getElementById('lobby-category-select');
const startGameBtn = document.getElementById('start-game-btn');
const waitingMsg = document.getElementById('waiting-msg');

// Game Elements
const gameRoomId = document.getElementById('game-room-id');
const gameCategory = document.getElementById('game-category');
const turnIndicator = document.getElementById('turn-indicator');
const playersGrid = document.getElementById('players-grid');
const activeTurnPanel = document.getElementById('active-turn-panel');
const waitingTurnPanel = document.getElementById('waiting-turn-panel');
const gameOverPanel = document.getElementById('game-over-panel');
const currentPlayerName = document.getElementById('current-player-name');
const guessInput = document.getElementById('guess-input');
const guessBtn = document.getElementById('guess-btn');
const endTurnBtn = document.getElementById('end-turn-btn');
const playAgainBtn = document.getElementById('play-again-btn');
const guessesLeftSpan = document.getElementById('guesses-left');
const myGuessesLeftSpan = document.getElementById('my-guesses-left');
const gameOverMsg = document.getElementById('game-over-msg');

let ws;
let myId = null;
let isHost = false;

// Connect to websocket
function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    ws = new WebSocket(wsUrl);

    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.type === 'error') {
            errorMsg.innerText = data.message;
            return;
        }
        
        if (data.type === 'game_state') {
            updateGameState(data);
        }
    };

    ws.onclose = () => {
        alert("Disconnected from server. Please refresh.");
    };
}

function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(screenId).classList.add('active');
}

joinBtn.addEventListener('click', () => {
    const name = playerNameInput.value.trim();
    const roomId = document.getElementById('room-id').value.trim();
    const category = categorySelect.value;
    
    if (!name || !roomId) {
        errorMsg.innerText = "Please enter name and room ID";
        return;
    }
    
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        connectWebSocket();
        // Wait for connection to open before sending join
        ws.onopen = () => {
            ws.send(JSON.stringify({ action: 'join', roomId, name, category }));
        };
    } else {
        ws.send(JSON.stringify({ action: 'join', roomId, name, category }));
    }
});

// Populate lobby category select
const categories = ["Anime Characters", "Animals", "Real Famous People", "Video Game Characters", "Sports Persons", "Superheroes", "Cartoon Characters", "Movie Characters", "Mythological Creatures", "Historical Figures", "Musicians & Singers", "Disney Princesses", "Villains", "Sci-Fi Characters", "Fantasy Characters", "Comedians", "Internet Personalities", "Wrestlers", "Famous Dogs", "Board Game/Toy Characters"];
categories.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c;
    opt.innerText = c;
    lobbyCategorySelect.appendChild(opt);
});

lobbyCategorySelect.addEventListener('change', () => {
    ws.send(JSON.stringify({ action: 'update_category', category: lobbyCategorySelect.value }));
});

startGameBtn.addEventListener('click', () => {
    ws.send(JSON.stringify({ action: 'start_game' }));
});

guessBtn.addEventListener('click', () => {
    const guess = guessInput.value.trim();
    if (guess) {
        ws.send(JSON.stringify({ action: 'make_guess', guess }));
        guessInput.value = '';
    }
});

endTurnBtn.addEventListener('click', () => {
    ws.send(JSON.stringify({ action: 'end_turn' }));
});

playAgainBtn.addEventListener('click', () => {
    ws.send(JSON.stringify({ action: 'play_again' }));
});

function updateGameState(state) {
    myId = state.myId;
    isHost = (myId === state.hostId);
    
    if (state.phase === 'lobby') {
        showScreen('lobby-screen');
        displayRoomId.innerText = state.roomId;
        displayCategory.innerText = state.category;
        
        if (isHost) {
            hostControls.classList.remove('hidden');
            waitingMsg.classList.add('hidden');
            lobbyCategorySelect.value = state.category;
        } else {
            hostControls.classList.add('hidden');
            waitingMsg.classList.remove('hidden');
        }
        
        // Render players
        playersList.innerHTML = '';
        state.players.forEach(p => {
            const li = document.createElement('li');
            li.innerHTML = `<span>${p.name}</span> ${p.id === state.hostId ? '<span class="host-badge">Host</span>' : ''}`;
            playersList.appendChild(li);
        });
        
    } else if (state.phase === 'playing' || state.phase === 'game_over') {
        showScreen('game-screen');
        gameRoomId.innerText = state.roomId;
        gameCategory.innerText = state.category;
        
        const turnPlayer = state.players[state.turnIndex];
        const isMyTurn = turnPlayer.id === myId;
        const me = state.players.find(p => p.id === myId);
        
        if (state.phase === 'game_over') {
            turnIndicator.innerHTML = "Game Over!";
            turnIndicator.className = "turn-indicator";
            activeTurnPanel.classList.add('hidden');
            waitingTurnPanel.classList.add('hidden');
            gameOverPanel.classList.remove('hidden');
            
            if (me.isWinner) {
                gameOverMsg.innerText = "Congratulations! You guessed correctly.";
                gameOverMsg.style.color = "var(--success)";
            } else if (me.isLoser) {
                gameOverMsg.innerText = "Tough luck! You lost.";
                gameOverMsg.style.color = "var(--danger)";
            } else {
                gameOverMsg.innerText = "Game Over!";
            }
            
            if (isHost) {
                playAgainBtn.classList.remove('hidden');
            } else {
                playAgainBtn.classList.add('hidden');
            }
        } else {
            gameOverPanel.classList.add('hidden');
            
            if (isMyTurn) {
                turnIndicator.innerHTML = "It's your turn!";
                turnIndicator.className = "turn-indicator your-turn";
                activeTurnPanel.classList.remove('hidden');
                waitingTurnPanel.classList.add('hidden');
                guessesLeftSpan.innerText = me.guessesLeft;
                
                if (me.isWinner || me.isLoser) {
                     // Shouldn't happen based on backend logic, but just in case
                     activeTurnPanel.classList.add('hidden');
                }
            } else {
                turnIndicator.innerHTML = `${turnPlayer.name}'s turn`;
                turnIndicator.className = "turn-indicator";
                activeTurnPanel.classList.add('hidden');
                waitingTurnPanel.classList.remove('hidden');
                currentPlayerName.innerText = turnPlayer.name;
                myGuessesLeftSpan.innerText = me.guessesLeft;
                
                if (me.isWinner || me.isLoser) {
                     waitingTurnPanel.innerHTML = `<h3>Waiting for others...</h3><p>You ${me.isWinner ? 'won!' : 'lost.'}</p>`;
                }
            }
        }
        
        // Render Player Cards
        playersGrid.innerHTML = '';
        state.players.forEach(p => {
            const card = document.createElement('div');
            let classNames = 'player-card';
            if (p.id === myId) classNames += ' is-me';
            if (p.isWinner) classNames += ' is-winner';
            if (p.isLoser) classNames += ' is-loser';
            card.className = classNames;
            
            let charDisplay = '';
            if (p.character === "?") {
                charDisplay = `<div class="character-display"><span class="unknown-character">?</span></div>`;
            } else {
                charDisplay = `<div class="character-display"><span>${p.character}</span></div>`;
            }
            
            let statusBadge = '';
            if (p.isWinner) statusBadge = `<span class="status-badge status-winner">Winner</span>`;
            if (p.isLoser) statusBadge = `<span class="status-badge status-loser">Eliminated</span>`;
            
            card.innerHTML = `
                ${statusBadge}
                <div class="player-name">${p.name} ${p.id === myId ? '(You)' : ''}</div>
                ${charDisplay}
            `;
            playersGrid.appendChild(card);
        });
    }
}
