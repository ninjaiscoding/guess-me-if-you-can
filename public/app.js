const loginScreen = document.getElementById('login-screen');
const lobbyScreen = document.getElementById('lobby-screen');
const customWordScreen = document.getElementById('custom-word-screen');
const gameScreen = document.getElementById('game-screen');

// Global Layout Elements
const topGlobalBar = document.getElementById('top-global-bar');
const globalLeaveBtn = document.getElementById('global-leave-btn');
const hostBackLobbyBtn = document.getElementById('host-back-lobby-btn');

// Login Elements
const playerNameInput = document.getElementById('player-name');
const roomIdInput = document.getElementById('room-id');
const joinBtn = document.getElementById('join-btn');
const errorMsg = document.getElementById('login-error');

// Lobby Elements
const displayRoomId = document.getElementById('display-room-id');
const displayCategory = document.getElementById('display-category');
const displayTimerSettings = document.getElementById('display-timer-settings');
const displayCustomSettings = document.getElementById('display-custom-settings');
const playersList = document.getElementById('lobby-players-list');
const hostControls = document.getElementById('host-controls');
const lobbyCategorySelect = document.getElementById('lobby-category-select');
const lobbyTimerSelect = document.getElementById('lobby-timer-select');
const lobbyCustomWords = document.getElementById('lobby-custom-words');
const startGameBtn = document.getElementById('start-game-btn');
const waitingMsg = document.getElementById('waiting-msg');

// Custom Word Screen Elements
const customWordInput = document.getElementById('custom-word-input');
const submitWordBtn = document.getElementById('submit-word-btn');
const wordInputZone = document.getElementById('word-input-zone');
const wordSubmittedMsg = document.getElementById('word-submitted-msg');

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
const roundTimerCountdown = document.getElementById('round-timer-countdown');

let ws;
let myId = null;
let isHost = false;
let savedRoomId = '';
let savedName = '';

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
        
        // Handle Kick event
        if (data.type === 'kicked') {
            alert(data.message);
            savedName = '';
            savedRoomId = '';
            if (ws) {
                ws.onclose = null; // Unbind automatic reconnect
                ws.close();
            }
            showScreen('login-screen');
            return;
        }
        
        if (data.type === 'game_state') {
            updateGameState(data);
        }
    };

    ws.onclose = () => {
        console.log("WebSocket dropped. Reconnecting automatically...");
        setTimeout(() => {
            if (savedRoomId && savedName) {
                connectWebSocket();
                ws.onopen = () => {
                    ws.send(JSON.stringify({ action: 'join', roomId: savedRoomId, name: savedName }));
                };
            }
        }, 2000);
    };
}

function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(screenId).classList.add('active');
    
    if (screenId === 'login-screen') {
        topGlobalBar.classList.add('hidden');
    } else {
        topGlobalBar.classList.remove('hidden');
    }
}

joinBtn.addEventListener('click', () => {
    savedName = playerNameInput.value.trim();
    savedRoomId = roomIdInput.value.trim();
    
    if (!savedName || !savedRoomId) {
        errorMsg.innerText = "Please enter name and room ID";
        return;
    }
    
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        connectWebSocket();
        ws.onopen = () => {
            ws.send(JSON.stringify({ action: 'join', roomId: savedRoomId, name: savedName }));
        };
    } else {
        ws.send(JSON.stringify({ action: 'join', roomId: savedRoomId, name: savedName }));
    }
});

// Setup Category Options
const categories = ["Anime Characters", "Animals", "Real Famous People", "countries and cities", "Sports Persons", "Superheroes", "Cartoon Characters", "Movie Characters", "Mythological Creatures", "Historical Figures", "Musicians & Singers", "Vehicles", "Villains", "Sci-Fi Characters", "Fantasy Characters", "Comedians", "Youtubers", "Professions & Jobs", "Space", "video Games"];
categories.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c;
    opt.innerText = c;
    lobbyCategorySelect.appendChild(opt);
});

function sendLobbySettingsUpdate() {
    if (isHost && ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            action: 'update_lobby_settings',
            category: lobbyCategorySelect.value,
            timerOption: lobbyTimerSelect.value,
            customWordsEnabled: lobbyCustomWords.checked
        }));
    }
}

lobbyCategorySelect.addEventListener('change', sendLobbySettingsUpdate);
lobbyTimerSelect.addEventListener('change', sendLobbySettingsUpdate);
lobbyCustomWords.addEventListener('change', sendLobbySettingsUpdate);

startGameBtn.addEventListener('click', () => {
    ws.send(JSON.stringify({ action: 'start_game' }));
});

submitWordBtn.addEventListener('click', () => {
    const word = customWordInput.value.trim();
    if (word) {
        ws.send(JSON.stringify({ action: 'submit_custom_word', word: word }));
        wordInputZone.classList.add('hidden');
        wordSubmittedMsg.classList.remove('hidden');
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
    ws.send(JSON.stringify({ action: 'play_again' }));
});

hostBackLobbyBtn.addEventListener('click', () => {
    if (confirm("Are you sure you want to end the game and go back to the lobby?")) {
        ws.send(JSON.stringify({ action: 'back_to_lobby' }));
    }
});

globalLeaveBtn.addEventListener('click', () => {
    if (confirm("Are you sure you want to leave this game room completely?")) {
        savedName = '';
        savedRoomId = '';
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ action: 'leave_game' }));
        }
        showScreen('login-screen');
    }
});

// Global Window helper to handle dynamic Kicking from Player Cards during a match
window.kickPlayer = (playerId, name) => {
    if (confirm(`Are you absolutely sure you want to kick ${name} from the game?`)) {
        ws.send(JSON.stringify({ action: 'kick', playerId: playerId }));
    }
};

function updateGameState(state) {
    myId = state.myId;
    isHost = (myId === state.hostId);
    
    if (isHost && state.phase !== 'lobby') {
        hostBackLobbyBtn.classList.remove('hidden');
    } else {
        hostBackLobbyBtn.classList.add('hidden');
    }
    
    if (state.phase === 'lobby') {
        showScreen('lobby-screen');
        displayRoomId.innerText = state.roomId;
        displayCategory.innerText = state.category;
        displayTimerSettings.innerText = state.timerOption + "s";
        displayCustomSettings.innerText = state.customWordsEnabled ? "Enabled" : "Disabled";
        
        wordInputZone.classList.remove('hidden');
        wordSubmittedMsg.classList.add('hidden');
        customWordInput.value = '';
        
        if (isHost) {
            hostControls.classList.remove('hidden');
            waitingMsg.classList.add('hidden');
            lobbyCategorySelect.value = state.category;
            lobbyTimerSelect.value = state.timerOption;
            lobbyCustomWords.checked = state.customWordsEnabled;
        } else {
            hostControls.classList.add('hidden');
            waitingMsg.classList.remove('hidden');
        }
        
        playersList.innerHTML = '';
        state.players.forEach(p => {
            const li = document.createElement('li');
            let playerStatusStr = p.id === state.hostId ? '<span class="host-badge">Host</span>' : '';
            if (p.isDisconnected) {
                playerStatusStr += ' <span class="status-badge status-loser" style="position:static; margin-left:5px;">DC</span>';
            }
            
            li.innerHTML = `<span>${p.name}</span> <span style="display: flex; align-items: center;">${playerStatusStr}</span>`;
            
            // Add Kick Button in Lobby for the Host
            if (isHost && p.id !== myId) {
                const kickBtn = document.createElement('button');
                kickBtn.className = 'kick-btn';
                kickBtn.innerText = 'Kick';
                kickBtn.onclick = () => {
                    if (confirm(`Kick ${p.name}?`)) {
                        ws.send(JSON.stringify({ action: 'kick', playerId: p.id }));
                    }
                };
                li.querySelector('span:last-child').appendChild(kickBtn);
            }
            
            playersList.appendChild(li);
        });
        
    } else if (state.phase === 'custom_words_assign') {
        showScreen('custom-word-screen');
        
    } else if (state.phase === 'playing' || state.phase === 'game_over') {
        showScreen('game-screen');
        gameRoomId.innerText = state.roomId;
        gameCategory.innerText = state.customWordsEnabled ? "Custom Secret Words" : state.category;
        roundTimerCountdown.innerText = state.timerRemaining;
        
        const turnPlayer = state.players[state.turnIndex];
        const isMyTurn = turnPlayer.id === myId;
        const me = state.players.find(p => p.id === myId);
        
        if (state.phase === 'game_over') {
            turnIndicator.innerHTML = "Game Over!";
            turnIndicator.className = "turn-indicator";
            activeTurnPanel.classList.add('hidden');
            waitingTurnPanel.classList.add('hidden');
            gameOverPanel.classList.remove('hidden');
            
            if (me && me.isWinner) {
                gameOverMsg.innerText = "Congratulations! You guessed correctly.";
                gameOverMsg.style.color = "var(--success)";
            } else if (me && me.isLoser) {
                gameOverMsg.innerText = "Tough luck! You lost.";
                gameOverMsg.style.color = "var(--danger)";
            } else {
                gameOverMsg.innerText = "Game Over!";
                gameOverMsg.style.color = "var(--text-main)";
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
                if (me) guessesLeftSpan.innerText = me.guessesLeft;
            } else {
                turnIndicator.innerHTML = `${turnPlayer ? turnPlayer.name : 'Unknown'}'s turn`;
                turnIndicator.className = "turn-indicator";
                activeTurnPanel.classList.add('hidden');
                waitingTurnPanel.classList.remove('hidden');
                currentPlayerName.innerText = turnPlayer ? turnPlayer.name : 'Someone';
                if (me) myGuessesLeftSpan.innerText = me.guessesLeft;
                
                if (me && (me.isWinner || me.isLoser)) {
                     waitingTurnPanel.innerHTML = `<h3>Waiting for others...</h3><p>You ${me.isWinner ? 'won!' : 'lost.'}</p>`;
                }
            }
        }
        
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
            if (p.isDisconnected && !p.isWinner && !p.isLoser) statusBadge = `<span class="status-badge status-loser" style="background:#f59e0b">DC</span>`;
            
            // Render a Kick button overlay on player cards for the host during gameplay
            let kickCardHtml = '';
            if (isHost && p.id !== myId) {
                kickCardHtml = `<button class="kick-card-btn" onclick="kickPlayer('${p.id}', '${p.name}')">Kick</button>`;
            }
            
            card.innerHTML = `
                ${statusBadge}
                ${kickCardHtml}
                <div class="player-name">${p.name} ${p.id === myId ? '(You)' : ''}</div>
                ${charDisplay}
            `;
            playersGrid.appendChild(card);
        });
    }
}
