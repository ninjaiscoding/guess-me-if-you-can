const loginScreen = document.getElementById('login-screen');
const lobbyScreen = document.getElementById('lobby-screen');
const gameScreen = document.getElementById('game-screen');

if (!localStorage.getItem('game_player_id')) {
    const uniqueId = 'player_' + Math.random().toString(36).substring(2, 11) + Date.now().toString(36);
    localStorage.setItem('game_player_id', uniqueId);
}
const playerId = localStorage.getItem('game_player_id');

// Login Elements
const playerNameInput = document.getElementById('player-name');
const joinBtn = document.getElementById('join-btn');
const errorMsg = document.getElementById('login-error');
const categorySelect = document.getElementById('category-select');
const loginTimerSelect = document.getElementById('timer-select');

// Lobby Elements
const displayRoomId = document.getElementById('display-room-id');
const displayCategory = document.getElementById('display-category');
const displayTimer = document.getElementById('display-timer');
const playersList = document.getElementById('lobby-players-list');
const hostControls = document.getElementById('host-controls');
const lobbyCategorySelect = document.getElementById('lobby-category-select');
const lobbyTimerSelect = document.getElementById('lobby-timer-select');
const startGameBtn = document.getElementById('start-game-btn');
const waitingMsg = document.getElementById('waiting-msg');
const lobbyLeaveBtn = document.getElementById('lobby-leave-btn');

// Game Elements
const gameRoomId = document.getElementById('game-room-id');
const gameCategory = document.getElementById('game-category');
const turnIndicator = document.getElementById('turn-indicator');
const countdownTimerSpan = document.getElementById('countdown-timer');
const playersGrid = document.getElementById('players-grid');
const activeTurnPanel = document.getElementById('active-turn-panel');
const waitingTurnPanel = document.getElementById('waiting-turn-panel');
const gameOverPanel = document.getElementById('game-over-panel');
const writingPanel = document.getElementById('writing-panel');
const writingTargetName = document.getElementById('writing-target-name');
const customWordInput = document.getElementById('custom-word-input');
const customWordBtn = document.getElementById('submit-word-btn');
const currentPlayerName = document.getElementById('current-player-name');
const guessInput = document.getElementById('guess-input');
const guessBtn = document.getElementById('guess-btn');
const endTurnBtn = document.getElementById('end-turn-btn');
const playAgainBtn = document.getElementById('play-again-btn');
const hostBackToLobbyBtn = document.getElementById('host-back-to-lobby-btn');
const gameLeaveBtn = document.getElementById('game-leave-btn');
const guessesLeftSpan = document.getElementById('guesses-left');
const myGuessesLeftSpan = document.getElementById('my-guesses-left');
const gameOverMsg = document.getElementById('game-over-msg');

let ws;
let myId = playerId;
let isHost = false;
let cachedJoinData = null; // Remembers current identity for background auto-reconnections

function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
        // Automatically handshake back into the game room if disconnected unexpectedly
        if (cachedJoinData) {
            ws.send(JSON.stringify({ action: 'join', ...cachedJoinData }));
        }
    };

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
        setTimeout(connectWebSocket, 1500); // Reconnect loop
    };
}

connectWebSocket();

function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(screenId).classList.add('active');
}

joinBtn.addEventListener('click', () => {
    const name = playerNameInput.value.trim();
    const roomId = document.getElementById('room-id').value.trim().toUpperCase(); // Enforce uniform uppercase syntax
    const category = categorySelect.value;
    const timerLimit = loginTimerSelect.value;
    
    if (!name || !roomId) {
        errorMsg.innerText = "Please enter name and room ID";
        return;
    }
    
    // Save configurations to state cache
    cachedJoinData = { playerId, roomId, name, category, timerLimit };
    
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        connectWebSocket();
        ws.onopen = () => {
            ws.send(JSON.stringify({ action: 'join', ...cachedJoinData }));
        };
    } else {
        ws.send(JSON.stringify({ action: 'join', ...cachedJoinData }));
    }
});

const categories = ["Anime Characters", "Animals", "Real Famous People", "Video Game Characters", "Sports Persons", "Superheroes", "Cartoon Characters", "Movie Characters", "Mythological Creatures", "Historical Figures", "Musicians & Singers", "Disney Princesses", "Villains", "Sci-Fi Characters", "Fantasy Characters", "Comedians", "Internet Personalities", "Wrestlers", "Famous Dogs", "Board Game/Toy Characters", "Custom Words"];
categories.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c;
    opt.innerText = c;
    lobbyCategorySelect.appendChild(opt);
});

function sendLobbySettings() {
    ws.send(JSON.stringify({
        action: 'update_lobby_settings',
        category: lobbyCategorySelect.value,
        timerLimit: lobbyTimerSelect.value
    }));
}

lobbyCategorySelect.addEventListener('change', sendLobbySettings);
lobbyTimerSelect.addEventListener('change', sendLobbySettings);

startGameBtn.addEventListener('click', () => {
    ws.send(JSON.stringify({ action: 'start_game' }));
});

customWordBtn.addEventListener('click', () => {
    const word = customWordInput.value.trim();
    if (word) {
        ws.send(JSON.stringify({ action: 'submit_custom_word', word }));
        customWordInput.value = '';
    }
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
    ws.send(JSON.stringify({ action: 'back_to_lobby' }));
});

hostBackToLobbyBtn.addEventListener('click', () => {
    ws.send(JSON.stringify({ action: 'back_to_lobby' }));
});

const handleLeaveAction = () => {
    cachedJoinData = null; // Drop room memory context entirely upon intentional exit
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ action: 'leave' }));
    }
    showScreen('login-screen');
};

lobbyLeaveBtn.addEventListener('click', handleLeaveAction);
gameLeaveBtn.addEventListener('click', handleLeaveAction);

function updateGameState(state) {
    isHost = (playerId === state.hostId);
    
    if (isHost && state.phase !== 'lobby') {
        hostBackToLobbyBtn.classList.remove('hidden');
    } else {
        hostBackToLobbyBtn.classList.add('hidden');
    }

    if (state.phase === 'lobby') {
        showScreen('lobby-screen');
        displayRoomId.innerText = state.roomId;
        displayCategory.innerText = state.category;
        displayTimer.innerText = state.timerLimit === 'none' ? 'None' : `${state.timerLimit} Seconds`;
        
        if (isHost) {
            hostControls.classList.remove('hidden');
            waitingMsg.classList.add('hidden');
            lobbyCategorySelect.value = state.category;
            lobbyTimerSelect.value = state.timerLimit;
        } else {
            hostControls.classList.add('hidden');
            waitingMsg.classList.remove('hidden');
        }
        
        playersList.innerHTML = '';
        state.players.forEach(p => {
            const li = document.createElement('li');
            const offlineBadge = p.online ? '' : ' <span class="offline-badge">(Disconnected)</span>';
            li.innerHTML = `<span>${p.name}${offlineBadge}</span> ${p.id === state.hostId ? '<span class="host-badge">Host</span>' : ''}`;
            if (!p.online) li.classList.add('is-offline');
            playersList.appendChild(li);
        });
        
    } else if (state.phase === 'writing') {
        showScreen('game-screen');
        gameRoomId.innerText = state.roomId;
        gameCategory.innerText = "Assign Custom Characters";
        
        turnIndicator.innerText = "Assigning Names!";
        activeTurnPanel.classList.add('hidden');
        waitingTurnPanel.classList.add('hidden');
        gameOverPanel.classList.add('hidden');
        
        const me = state.players.find(p => p.id === playerId);
        if (me && !me.customWordSubmitted) {
            writingPanel.classList.remove('hidden');
            writingTargetName.innerText = me.customTargetName;
        } else {
            writingPanel.classList.add('hidden');
            turnIndicator.innerText = "Waiting for other players to submit custom words...";
        }
        
        renderPlayerCards(state);

    } else if (state.phase === 'playing' || state.phase === 'game_over') {
        showScreen('game-screen');
        writingPanel.classList.add('hidden');
        gameRoomId.innerText = state.roomId;
        gameCategory.innerText = state.category;
        
        const turnPlayer = state.players[state.turnIndex];
        const isMyTurn = turnPlayer.id === playerId;
        const me = state.players.find(p => p.id === playerId);
        
        if (state.timerRemaining !== null && state.phase === 'playing') {
            countdownTimerSpan.parentElement.classList.remove('hidden');
            countdownTimerSpan.innerText = `${state.timerRemaining}s`;
        } else {
            countdownTimerSpan.parentElement.classList.add('hidden');
        }

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
            } else {
                turnIndicator.innerHTML = `${turnPlayer.name}'s turn`;
                turnIndicator.className = "turn-indicator";
                activeTurnPanel.classList.add('hidden');
                waitingTurnPanel.classList.remove('hidden');
                currentPlayerName.innerText = turnPlayer.name;
                myGuessesLeftSpan.innerText = me.guessesLeft;
            }
        }
        
        renderPlayerCards(state);
    }
}

function renderPlayerCards(state) {
    playersGrid.innerHTML = '';
    state.players.forEach(p => {
        const card = document.createElement('div');
        let classNames = 'player-card';
        if (p.id === playerId) classNames += ' is-me';
        if (p.isWinner) classNames += ' is-winner';
        if (p.isLoser) classNames += ' is-loser';
        if (!p.online) classNames += ' is-offline';
        card.className = classNames;
        
        let charDisplay = '';
        if (state.phase === 'writing') {
            charDisplay = `<div class="character-display"><span>${p.customWordSubmitted ? 'Ready ✓' : 'Writing... ✎'}</span></div>`;
        } else {
            if (p.character === "?") {
                charDisplay = `<div class="character-display"><span class="unknown-character">?</span></div>`;
            } else {
                charDisplay = `<div class="character-display"><span>${p.character}</span></div>`;
            }
        }
        
        let statusBadge = '';
        if (!p.online) statusBadge = `<span class="status-badge status-offline">Offline</span>`;
        else if (p.isWinner) statusBadge = `<span class="status-badge status-winner">Winner</span>`;
        else if (p.isLoser) statusBadge = `<span class="status-badge status-loser">Eliminated</span>`;
        
        card.innerHTML = `
            ${statusBadge}
            <div class="player-name">${p.name} ${p.id === playerId ? '(You)' : ''}</div>
            ${charDisplay}
        `;
        playersGrid.appendChild(card);
    });
}
