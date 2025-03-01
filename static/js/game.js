class GameClient {
    constructor(matchId) {
        this.matchId = matchId;
        this.socket = io();
        this.gameState = null;
        this.selectedCard = null;
        this.selectedCell = null;
        this.privateChatWindows = new Map();
        this.currentPlayerName = document.querySelector('#current-user').dataset.username;
        this.gameBoard = document.getElementById('game-board');
        this.player1Hand = document.getElementById('player1-hand');
        this.player2Hand = document.getElementById('player2-hand');
        this.turnIndicator = document.getElementById('turn-indicator');
        
        // Set opponent name in header
        const opponentNameEl = document.querySelector('.opponent-name');
        if (opponentNameEl) {
            opponentNameEl.textContent = 'Waiting...';
        }
        
        // Initialize sounds
        this.sounds = {
            'capture': new Audio('/static/sounds/capture.mp3'),
            'place': new Audio('/static/sounds/place.mp3'),
            'select': new Audio('/static/sounds/select.mp3'),
            'error': new Audio('/static/sounds/error.mp3')
        };
        
        // Preload sounds
        Object.values(this.sounds).forEach(sound => {
            sound.load();
        });
        
        this.loadInitialGameState();
        this.bindEvents();
        this.setupSocketListeners();
        this.initializeFriendsPanel();
    }

    async loadInitialGameState() {
        try {
            const response = await fetch(`/game/${this.matchId}/state`);
            if (!response.ok) throw new Error('Failed to load game state');
            this.gameState = await response.json();
            this.renderGameState();
        } catch (error) {
            showAlert('Failed to load game state', 'error');
        }
    }

    bindEvents() {
        document.getElementById('end-turn-btn').addEventListener('click', () => this.endTurn());
        document.getElementById('surrender-btn').addEventListener('click', () => this.surrender());

        // Touch events for mobile
        const grid = document.querySelector('.grid');
        document.querySelectorAll('.hand').forEach(hand => {
            hand.addEventListener('touchstart', (e) => this.handleTouchStart(e), { passive: false });
            hand.addEventListener('touchmove', (e) => this.handleTouchMove(e), { passive: false });
            hand.addEventListener('touchend', (e) => this.handleTouchEnd(e), { passive: false });
        });

        // Click events for card selection and placement
        document.querySelectorAll('.hand').forEach(hand => {
            hand.addEventListener('click', (e) => {
                const card = e.target.closest('.card');
                if (card) this.handleCardSelect(card);
            });
        });

        grid.addEventListener('click', (e) => {
            const cell = e.target.closest('.cell');
            if (cell && this.selectedCard) {
                const row = parseInt(cell.dataset.row);
                const col = parseInt(cell.dataset.col);
                this.handleCardPlace(row, col);
            }
        });
    }

    setupSocketListeners() {
        this.socket.on('game_state_update', (data) => {
            console.log('Received game state update', data);
            this.gameState = data;
            this.renderGameState();
            
            // If turn has changed, announce the new turn
            if (this._lastTurn !== this.gameState.current_turn) {
                this.announceTurn(this.gameState.current_turn);
                this._lastTurn = this.gameState.current_turn;
            }
        });
        
        // Add the coins_update listener
        this.socket.on('coins_update', (data) => {
            this.handleCoinsUpdate(data);
        });
        
        this.socket.on('game_message', (data) => {
            const chatMessages = document.querySelector('#game-chat .chat-messages');
            if (chatMessages) {
                chatMessages.insertAdjacentHTML('beforeend', this.formatChatMessage(data));
                chatMessages.scrollTop = chatMessages.scrollHeight;
            }
        });

        this.socket.on('private_message', (data) => {
            // Open chat window if it doesn't exist
            if (!this.privateChatWindows.has(data.from)) {
                this.openPrivateChat(data.from);
            }
            
            const chat = this.privateChatWindows.get(data.from);
            const messages = chat.querySelector('.chat-messages');
            messages.insertAdjacentHTML('beforeend', this.formatChatMessage(data));
            messages.scrollTop = messages.scrollHeight;

            // If chat is minimized, show notification
            if (chat.classList.contains('minimized')) {
                this.showChatNotification(data.from);
            }
        });

        this.socket.on('friend_request', (data) => {
            this.loadFriendRequests(); // Refresh friend requests count
            showAlert(`New friend request from ${data.from}`, 'info');
        });

        this.socket.on('friend_request_accepted', (data) => {
            showAlert(`${data.username} accepted your friend request!`, 'success');
            this.loadFriendsList(); // Refresh friends list
        });

        // Handle card-specific events with animations
        this.socket.on('card_played', (data) => {
            const cardEl = document.querySelector(`[data-card-name="${data.card.name}"]`);
            if (cardEl) {
                this.animateCardPlacement(cardEl, data.row, data.col);
            }
            // Update state after animation
            setTimeout(() => {
                this.gameState = data.gameState;
                this.renderGameState();
            }, 500);
        });

        this.socket.on('card_flipped', (data) => {
            const cardEl = document.querySelector(`[data-row="${data.row}"][data-col="${data.col}"] .card`);
            if (cardEl) {
                this.animateCardFlip(cardEl);
            }
            // Update state after animation
            setTimeout(() => {
                this.gameState = data.gameState;
                this.renderGameState();
            }, 500);
        });

        this.socket.on('game_over', (data) => {
            this.handleGameOver(data);
        });

        this.socket.on('rematch_request', (data) => {
            this.handleRematchRequest(data);
        });

        this.socket.on('rematch_accepted', () => {
            window.location.reload();
        });

        this.socket.on('rematch_declined', () => {
            window.location.href = '/lobby';
        });

        this.socket.on('rematch_cancelled', () => {
            window.location.href = '/lobby';
        });
    }
    
    // Add this new method to handle coin updates
    handleCoinsUpdate(data) {
        // Update the coin balance in the UI
        const coinBalance = document.getElementById('coinBalance');
        const modalCoinBalance = document.getElementById('modalCoinBalance');
        
        if (coinBalance) {
            coinBalance.textContent = data.coins;
        }
        
        if (modalCoinBalance) {
            modalCoinBalance.textContent = data.coins;
        }
        
        // Show a notification for coin changes
        if (data.earned) {
            this.showCoinNotification(data.earned, data.reason, data.earned > 0);
        }
    }
    
    showCoinNotification(amount, reason, isPositive = true) {
        const notification = document.createElement('div');
        notification.className = `coin-notification ${isPositive ? 'positive' : 'negative'}`;
        notification.innerHTML = `
            <div class="coin-amount">${isPositive ? '+' : ''}${amount} 🪙</div>
            <div class="coin-reason">${reason}</div>
        `;
        
        document.body.appendChild(notification);
        
        // Animate notification
        setTimeout(() => {
            notification.classList.add('show');
            
            // Remove after animation
            setTimeout(() => {
                notification.classList.add('fade-out');
                setTimeout(() => {
                    notification.remove();
                }, 1000);
            }, 3000);
        }, 100);
    }

    renderGameState() {
        if (!this.gameState) return;
        
        const isPlayer1 = this.gameState.player1.name === this.currentPlayerName;
        const currentPlayer = isPlayer1 ? this.gameState.player1 : this.gameState.player2;
        const opponentPlayer = isPlayer1 ? this.gameState.player2 : this.gameState.player1;

        // Update opponent name in header
        const opponentNameEl = document.querySelector('.opponent-name');
        if (opponentNameEl) {
            opponentNameEl.textContent = opponentPlayer.name;
        }

        // Render scoreboard
        this.renderScoreboard();

        // Render player hands
        this.renderHand('player1-hand', currentPlayer.hand, true);
        this.renderHand('player2-hand', opponentPlayer.hand, false);

        // Render grid
        this.renderGrid();

        // Check for game over before showing turn indicator
        if (this.gameState.final_scores) {
            this.announceWinner();
        } else {
            // Only show turn indicator if game is not over
            this.renderTurnIndicator();
        }

        // Update effect slots
        this.renderEffectSlots(currentPlayer, opponentPlayer);
        
        // Render player areas with correct orientation
        this.renderPlayerAreas();
    }

    renderScoreboard() {
        // Count cards for each player
        let player1Cards = 0;
        let player2Cards = 0;
        
        for (let row = 0; row < this.gameState.grid.length; row++) {
            for (let col = 0; col < this.gameState.grid[row].length; col++) {
                const card = this.gameState.grid[row][col];
                if (card && card.type === 'CharacterCard') {
                    if (card.owner === this.gameState.player1.name) {
                        player1Cards++;
                    } else if (card.owner === this.gameState.player2.name) {
                        player2Cards++;
                    }
                }
            }
        }
        
        // Create or update scoreboard
        let scoreboard = document.querySelector('.scoreboard');
        if (!scoreboard) {
            scoreboard = document.createElement('div');
            scoreboard.className = 'scoreboard';
            const gameBoard = document.getElementById('game-board');
            gameBoard.insertBefore(scoreboard, gameBoard.firstChild);
        }
        
        scoreboard.innerHTML = `
            <div class="score-player player1-score">
                <div class="name">${this.gameState.player1.name}</div>
                <div class="cards-count">${player1Cards}</div>
            </div>
            <div class="score-divider">VS</div>
            <div class="score-player player2-score">
                <div class="name">${this.gameState.player2.name}</div>
                <div class="cards-count">${player2Cards}</div>
            </div>
        `;
        
        // Highlight current player's score
        const player1ScoreEl = scoreboard.querySelector('.player1-score');
        const player2ScoreEl = scoreboard.querySelector('.player2-score');
        
        player1ScoreEl.classList.toggle('current-turn', this.gameState.current_turn === this.gameState.player1.name);
        player2ScoreEl.classList.toggle('current-turn', this.gameState.current_turn === this.gameState.player2.name);
    }

    renderHand(containerId, cards, isCurrentPlayer) {
        const container = document.getElementById(containerId);
        container.innerHTML = '';

        // Determine if this is player2's view
        const isPlayer2View = this.gameState.player2.name === this.currentPlayerName;

        cards.forEach(card => {
            const cardEl = this.createCardElement(card);
            if (isCurrentPlayer && this.gameState.current_turn === this.currentPlayerName) {
                cardEl.classList.add('playable');
            }
            
            // Don't rotate cards in hand, they should always be readable
            if (containerId === 'player2-hand' && !isPlayer2View) {
                cardEl.style.transform = 'rotate(180deg)';
            }
            
            container.appendChild(cardEl);
        });
    }

    renderPlayers() {
        const p1Name = document.querySelector('.player1 .name');
        const p2Name = document.querySelector('.player2 .name');
        const p1Deck = document.querySelector('.player1 .deck-count');
        const p2Deck = document.querySelector('.player2 .deck-count');

        p1Name.textContent = this.gameState.player1.name;
        p2Name.textContent = this.gameState.player2.name;
        p1Deck.textContent = `Cards: ${this.gameState.player1.hand.length}`;
        p2Deck.textContent = `Cards: ${this.gameState.player2.hand.length}`;
    }

    renderTurnIndicator() {
        const indicator = document.getElementById('turn-indicator');
        const isMyTurn = this.gameState.current_turn === this.currentPlayerName;
        const turnPlayerName = isMyTurn ? 'Your' : 
            (this.gameState.current_turn === 'Computer' ? "Computer's" : 
            `${this.gameState.current_turn}'s`);
            
        indicator.innerHTML = `
            <div class="turn-status ${isMyTurn ? 'my-turn' : ''}">
                ${turnPlayerName} Turn
            </div>
        `;
        
        // If this is a new turn, announce it
        if (this._lastTurn !== this.gameState.current_turn) {
            this.announceTurn(turnPlayerName);
            this._lastTurn = this.gameState.current_turn;
        }
    }

    renderGrid() {
        const grid = document.querySelector('.grid');
        grid.innerHTML = '';
        
        // Determine if we need to flip the board (we're player2)
        const isPlayer2 = this.gameState.player2.name === this.currentPlayerName;
        
        // If player 2, we'll iterate in reverse to flip the board
        const rowOrder = isPlayer2 ? [2, 1, 0] : [0, 1, 2];
        const colOrder = isPlayer2 ? [4, 3, 2, 1, 0] : [0, 1, 2, 3, 4];
        
        for (const row of rowOrder) {
            for (const col of colOrder) {
                const cell = document.createElement('div');
                cell.classList.add('cell');
                cell.dataset.row = row;
                cell.dataset.col = col;
                
                const card = this.gameState.grid[row][col];
                if (card) {
                    const cardEl = this.createCardElement(card);
                    
                    // Rotate card if it belongs to opponent, regardless of board orientation
                    if (card.owner && card.owner !== this.currentPlayerName) {
                        cardEl.style.transform = 'rotate(180deg)';
                    }
                    
                    cell.appendChild(cardEl);
                } else {
                    cell.classList.add('empty');
                }

                grid.appendChild(cell);
            }
        }

        // Add a class to the grid to handle the visual flip
        grid.classList.toggle('flipped', isPlayer2);
    }

    renderPlayerAreas() {
        const isPlayer2 = this.gameState.player2.name === this.currentPlayerName;
        const gameBoard = document.getElementById('game-board');
        
        // Flip the order of player areas for player 2
        if (isPlayer2) {
            gameBoard.classList.add('flipped');
        } else {
            gameBoard.classList.remove('flipped');
        }
    }

    createCardElement(card) {
        const cardEl = document.createElement('div');
        cardEl.classList.add('card');
        cardEl.dataset.cardName = card.name;
        
        if (card.type === 'CardBack') {
            cardEl.classList.add('card-back');
            cardEl.innerHTML = '<div class="card-back-design"></div>';
            return cardEl;
        }

        // Add type-specific classes
        cardEl.classList.add(`${card.type.toLowerCase()}`);
        
        // Add faction class if available
        if (card.faction) {
            cardEl.classList.add(card.faction.toLowerCase());
        }
        
        // Set owner if available - use exact username for data-owner
        if (card.owner) {
            cardEl.dataset.owner = card.owner;
            // Add specific classes for owner status
            if (card.owner === this.currentPlayerName) {
                cardEl.classList.add('owner-self');
            } else {
                cardEl.classList.add('owner-opponent');
            }
        }
        
        // Set captured state - only show captured state if the card belongs to the opponent
        if (card.is_captured && card.owner !== this.currentPlayerName) {
            cardEl.classList.add('captured');
        }

        // Determine if this card belongs to opponent
        const isOpponentCard = card.owner && card.owner !== this.currentPlayerName;

        let cardContent = '';
        
        if (card.type === 'CharacterCard') {
            // For opponent's cards, we need to flip both positions and values
            const elements = isOpponentCard ? {
                // Flip positions and values for opponent's cards
                Fire: {
                    position: 'Water',  // Top becomes bottom
                    value: card.elements.Water  // Use Water's value for Fire position
                },
                Water: {
                    position: 'Fire',   // Bottom becomes top
                    value: card.elements.Fire   // Use Fire's value for Water position
                },
                Air: {
                    position: 'Earth',  // Right becomes left
                    value: card.elements.Earth  // Use Earth's value for Air position
                },
                Earth: {
                    position: 'Air',    // Left becomes right
                    value: card.elements.Air    // Use Air's value for Earth position
                }
            } : {
                // Keep original positions and values for player's cards
                Fire: { position: 'Fire', value: card.elements.Fire },
                Water: { position: 'Water', value: card.elements.Water },
                Air: { position: 'Air', value: card.elements.Air },
                Earth: { position: 'Earth', value: card.elements.Earth }
            };

            cardContent = `
                <div class="card-header">${card.name}</div>
                <div class="card-content">
                    <div class="card-faction">${card.faction}</div>
                    <div class="card-elements">
                        <div class="card-element ${elements.Fire.position.toLowerCase()}" title="${elements.Fire.position}: ${elements.Fire.value}">
                            <span>${elements.Fire.value}</span>
                        </div>
                        <div class="card-element ${elements.Water.position.toLowerCase()}" title="${elements.Water.position}: ${elements.Water.value}">
                            <span>${elements.Water.value}</span>
                        </div>
                        <div class="card-element ${elements.Air.position.toLowerCase()}" title="${elements.Air.position}: ${elements.Air.value}">
                            <span>${elements.Air.value}</span>
                        </div>
                        <div class="card-element ${elements.Earth.position.toLowerCase()}" title="${elements.Earth.position}: ${elements.Earth.value}">
                            <span>${elements.Earth.value}</span>
                        </div>
                    </div>
                </div>
                ${card.owner ? `<div class="card-footer">Owned by: ${card.owner}</div>` : ''}`;
        } else if (card.type === 'ActionCard') {
            // Action card content
            cardContent = `
                <div class="card-header">${card.name}</div>
                <div class="card-content">
                    <div class="card-effect">Effect: ${card.effect_type}</div>
                    <div class="card-value">Value: ${card.value}</div>
                </div>
            `;
        } else if (card.type === 'EffectCard') {
            // Effect card content
            let bonusHtml = '';
            for (const [element, bonus] of Object.entries(card.element_bonuses)) {
                bonusHtml += `
                    <div class="card-bonus">
                        <span>${element}:</span>
                        <span>+${bonus}</span>
                    </div>
                `;
            }
            
            cardContent = `
                <div class="card-header">${card.name}</div>
                <div class="card-content">
                    <div class="card-bonuses">
                        ${bonusHtml}
                    </div>
                    ${card.bonus_effect ? `<div class="card-bonus-effect">${card.bonus_effect}</div>` : ''}
                </div>
            `;
        }
        
        cardEl.innerHTML = cardContent;
        return cardEl;
    }

    getCurrentPlayerName() {
        // Get username from current_user
        return document.querySelector('#current-user').dataset.username;
    }

    handleCardSelect(cardElement) {
        if (this.gameState.current_turn !== this.getCurrentPlayerName()) {
            showAlert("It's not your turn!", 'error');
            return;
        }

        // Deselect if already selected
        if (cardElement.classList.contains('selected')) {
            this.selectedCard = null;
            cardElement.classList.remove('selected');
            return;
        }

        // Remove selection from other cards
        document.querySelectorAll('.card.selected').forEach(card => {
            card.classList.remove('selected');
        });

        // Select the new card
        const cardName = cardElement.dataset.cardName;
        const isPlayer1 = this.gameState.player1.name === this.getCurrentPlayerName();
        const hand = isPlayer1 ? this.gameState.player1.hand : this.gameState.player2.hand;
        
        this.selectedCard = hand.find(c => c.name === cardName);
        if (this.selectedCard) {
            cardElement.classList.add('selected');
            cardElement.classList.add('playable');
        }
    }

    async handleCellClick(row, col) {
        if (!this.selectedCard) return;
        if (this.gameState.current_turn !== this.getCurrentPlayerName()) {
            showAlert("It's not your turn!", 'error');
            return;
        }
        
        try {
            const response = await fetch('/play_card', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    match_id: this.matchId,
                    card: this.selectedCard,
                    row: row,
                    col: col
                })
            });

            const data = await response.json();
            if (!response.ok) {
                throw new Error(data.error || 'Failed to play card');
            }

            this.gameState = data;
            this.selectedCard = null;
            this.renderGameState();
            
            // If playing against computer, simulate computer's turn after delay
            if (this.gameState.player2.name === 'Computer' && this.gameState.current_turn === 'Computer') {
                setTimeout(() => this.simulateComputerTurn(), 1000);
            }
        } catch (error) {
            showAlert(error.message, 'error');
        }
    }

    async endTurn() {
        if (this.gameState.current_turn !== this.gameState.player1.name) {
            return;
        }

        try {
            const response = await fetch('/end_turn', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                }
            });

            const data = await response.json();
            if (!response.ok) {
                throw new Error(data.error || 'Failed to end turn');
            }

            this.gameState = data;
            this.renderGameState();

            if (this.gameState.current_turn === 'Computer') {
                setTimeout(() => this.simulateComputerTurn(), 1000);
            }
        } catch (error) {
            showAlert(error.message, 'error');
        }
    }

    async simulateComputerTurn() {
        try {
            const response = await fetch('/computer_turn', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                }
            });

            const data = await response.json();
            if (!response.ok) {
                throw new Error(data.error || 'Computer turn failed');
            }

            this.gameState = data;
            this.renderGameState();
        } catch (error) {
            showAlert(error.message, 'error');
        }
    }

    handleGameOver(data) {
        const modal = document.createElement('div');
        modal.className = 'modal active';
        modal.innerHTML = `
            <div class="modal-content">
                <h2>${data.winner === this.gameState.player1.name ? 'Victory!' : 'Defeat'}</h2>
                <p>${data.message}</p>
                <button class="btn btn-primary" onclick="window.location.href='/lobby'">
                    Return to Lobby
                </button>
            </div>
        `;
        document.body.appendChild(modal);
    }

    async surrender() {
        if (confirm('Are you sure you want to surrender?')) {
            try {
                const response = await fetch('/surrender', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    }
                });

                if (!response.ok) {
                    throw new Error('Failed to surrender');
                }

                window.location.href = '/lobby';
            } catch (error) {
                showAlert(error.message, 'error');
            }
        }
    }

    updateChatWindow() {
        const chatWindow = document.querySelector('#game-chat');
        if (!chatWindow) {
            // Create chat window if it doesn't exist
            const chat = document.createElement('div');
            chat.id = 'game-chat';
            chat.innerHTML = `
                <div class="chat-header">
                    <span>Game Chat</span>
                    <button class="toggle-chat">_</button>
                </div>
                <div class="chat-messages"></div>
                <div class="chat-input">
                    <input type="text" placeholder="Type a message...">
                    <button>Send</button>
                </div>
            `;
            document.querySelector('#game-container').appendChild(chat);
            this.setupChatHandlers();
        }
    }

    setupChatHandlers() {
        const chatInput = document.querySelector('#game-chat input');
        const sendBtn = document.querySelector('#game-chat button');
        const toggleBtn = document.querySelector('.toggle-chat');

        sendBtn.addEventListener('click', () => this.sendGameMessage(chatInput.value));
        chatInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.sendGameMessage(chatInput.value);
        });
        toggleBtn.addEventListener('click', () => {
            const chat = document.querySelector('#game-chat');
            chat.classList.toggle('minimized');
            toggleBtn.textContent = chat.classList.contains('minimized') ? '+' : '_';
        });
    }

    sendGameMessage(message) {
        if (!message.trim()) return;
        
        this.socket.emit('game_message', {
            match_id: this.matchId,
            message: message.trim()
        });
        
        document.querySelector('#game-chat input').value = '';
    }

    initializeFriendsPanel() {
        // Friends search functionality
        const searchInput = document.querySelector('.friends-search input');
        let searchTimeout;
        
        searchInput.addEventListener('input', () => {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => this.searchUsers(searchInput.value), 300);
        });

        // Load initial friends list
        this.loadFriendsList();
        this.loadFriendRequests();

        // Setup friend request badge click
        document.querySelector('.friend-requests-badge').addEventListener('click', () => {
            document.getElementById('friendRequestModal').classList.add('active');
        });
    }

    async loadFriendsList() {
        try {
            const response = await fetch('/api/friends');
            const data = await response.json();
            this.renderFriendsList(data.friends);
        } catch (error) {
            console.error('Failed to load friends list:', error);
        }
    }

    async loadFriendRequests() {
        try {
            const response = await fetch('/api/friends/requests');
            const data = await response.json();
            const badge = document.querySelector('.friend-requests-badge');
            
            if (data.requests.length > 0) {
                badge.textContent = data.requests.length;
                badge.style.display = 'inline-block';
            } else {
                badge.style.display = 'none';
            }
        } catch (error) {
            console.error('Failed to load friend requests:', error);
        }
    }

    async searchUsers(query) {
        if (query.length < 2) return;

        try {
            const response = await fetch(`/api/friends/search?q=${encodeURIComponent(query)}`);
            const data = await response.json();
            
            const searchModal = document.getElementById('searchModal');
            const resultsList = searchModal.querySelector('.search-results-list');
            
            resultsList.innerHTML = data.users.map(user => `
                <div class="search-result-item">
                    <div class="user-info">
                        <span class="username">${user.username}</span>
                        <span class="rating">(${user.rating})</span>
                    </div>
                    <button class="btn btn-primary add-friend-btn" data-username="${user.username}">
                        Add Friend
                    </button>
                </div>
            `).join('');

            searchModal.classList.add('active');

            // Add click handlers for friend request buttons
            resultsList.querySelectorAll('.add-friend-btn').forEach(btn => {
                btn.addEventListener('click', () => this.sendFriendRequest(btn.dataset.username));
            });
        } catch (error) {
            showAlert('Failed to search users', 'error');
        }
    }

    async sendFriendRequest(username) {
        try {
            const response = await fetch('/api/friends/request', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username })
            });

            if (!response.ok) throw new Error('Failed to send friend request');
            
            showAlert(`Friend request sent to ${username}`, 'success');
            document.getElementById('searchModal').classList.remove('active');
        } catch (error) {
            showAlert(error.message, 'error');
        }
    }

    renderFriendsList(friends) {
        const friendsList = document.querySelector('.friends-list');
        friendsList.innerHTML = friends.map(friend => `
            <div class="friend-item">
                <div class="friend-avatar">${friend.username[0].toUpperCase()}</div>
                <div class="friend-info">
                    <div class="friend-name">${friend.username}</div>
                    <div class="friend-status">${friend.status}</div>
                </div>
                <button class="btn btn-small btn-secondary chat-btn">Chat</button>
            </div>
        `).join('');

        // Add chat button handlers
        friendsList.querySelectorAll('.chat-btn').forEach(btn => {
            const friendName = btn.closest('.friend-item').querySelector('.friend-name').textContent;
            btn.addEventListener('click', () => this.openPrivateChat(friendName));
        });
    }

    openPrivateChat(friendName) {
        if (this.privateChatWindows.has(friendName)) {
            const chat = this.privateChatWindows.get(friendName);
            chat.classList.remove('minimized');
            return;
        }

        const chat = document.createElement('div');
        chat.className = 'private-chat';
        chat.innerHTML = `
            <div class="chat-header">
                <span>${friendName}</span>
                <div class="chat-controls">
                    <button class="minimize-chat">_</button>
                    <button class="close-chat">×</button>
                </div>
            </div>
            <div class="chat-messages"></div>
            <div class="chat-input">
                <input type="text" placeholder="Type a message...">
                <button class="btn btn-primary send-btn">Send</button>
            </div>
        `;

        document.body.appendChild(chat);
        this.privateChatWindows.set(friendName, chat);

        // Position the chat window
        const offset = 320 * this.privateChatWindows.size;
        chat.style.right = `${offset}px`;

        // Add event listeners
        const input = chat.querySelector('input');
        const sendBtn = chat.querySelector('.send-btn');
        const minimizeBtn = chat.querySelector('.minimize-chat');
        const closeBtn = chat.querySelector('.close-chat');

        sendBtn.addEventListener('click', () => this.sendPrivateMessage(friendName, input));
        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.sendPrivateMessage(friendName, input);
        });

        minimizeBtn.addEventListener('click', () => {
            chat.classList.toggle('minimized');
            minimizeBtn.textContent = chat.classList.contains('minimized') ? '+' : '_';
        });

        closeBtn.addEventListener('click', () => {
            chat.remove();
            this.privateChatWindows.delete(friendName);
        });

        // Load chat history
        this.loadPrivateChatHistory(friendName);
    }

    async loadPrivateChatHistory(friendName) {
        try {
            const response = await fetch(`/api/chat/${friendName}`);
            const data = await response.json();
            
            const chatMessages = this.privateChatWindows.get(friendName).querySelector('.chat-messages');
            chatMessages.innerHTML = data.messages.map(msg => this.formatChatMessage(msg)).join('');
            chatMessages.scrollTop = chatMessages.scrollHeight;
        } catch (error) {
            console.error('Failed to load chat history:', error);
        }
    }

    sendPrivateMessage(friendName, input) {
        const message = input.value.trim();
        if (!message) return;

        this.socket.emit('private_message', {
            to: friendName,
            message: message
        });

        const chat = this.privateChatWindows.get(friendName);
        const messages = chat.querySelector('.chat-messages');
        messages.insertAdjacentHTML('beforeend', this.formatChatMessage({
            from: 'You',
            message: message,
            timestamp: new Date()
        }));
        messages.scrollTop = messages.scrollHeight;

        input.value = '';
    }

    formatChatMessage(msg) {
        const time = new Date(msg.timestamp).toLocaleTimeString();
        return `
            <div class="chat-message">
                <span class="chat-time">${time}</span>
                <span class="chat-user">${msg.from}:</span>
                <span class="chat-text">${msg.message}</span>
            </div>
        `;
    }

    handleDragStart(e) {
        if (this.gameState.current_turn !== this.getCurrentPlayerName()) {
            e.preventDefault();
            return;
        }

        const card = e.target.closest('.card');
        if (!card) return;

        card.classList.add('dragging');
        e.dataTransfer.setData('text/plain', card.dataset.cardData);
        e.dataTransfer.effectAllowed = 'move';

        // Create a custom drag image
        const dragImage = card.cloneNode(true);
        dragImage.style.transform = 'rotate(5deg)';
        dragImage.style.opacity = '0.8';
        document.body.appendChild(dragImage);
        e.dataTransfer.setDragImage(dragImage, card.offsetWidth / 2, card.offsetHeight / 2);
        setTimeout(() => dragImage.remove(), 0);
    }

    handleDragEnd(e) {
        const card = e.target.closest('.card');
        if (card) {
            card.classList.remove('dragging');
        }
    }

    handleDragOver(e) {
        e.preventDefault();
        const cell = e.target.closest('.cell');
        if (!cell) return;

        // Add visual feedback for valid drop targets
        if (!cell.querySelector('.card')) {
            cell.classList.add('valid-target');
        }
    }

    async handleDrop(e) {
        e.preventDefault();
        const cell = e.target.closest('.cell');
        if (!cell) return;

        // Remove visual feedback
        document.querySelectorAll('.cell').forEach(c => c.classList.remove('valid-target'));

        try {
            const cardData = JSON.parse(e.dataTransfer.getData('text/plain'));
            const row = parseInt(cell.dataset.row);
            const col = parseInt(cell.dataset.col);

            // Send play card request
            const response = await fetch('/play_card', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    match_id: this.matchId,
                    card: cardData,
                    row: row,
                    col: col
                })
            });

            const data = await response.json();
            if (!response.ok) {
                throw new Error(data.error || 'Failed to play card');
            }

            // Update game state and render
            this.gameState = data;
            this.renderGameState();

            // Add placement animation
            const placedCard = cell.querySelector('.card');
            if (placedCard) {
                placedCard.classList.add('placed');
                setTimeout(() => placedCard.classList.remove('placed'), 500);
            }

            // If playing against computer, simulate computer's turn after delay
            if (this.gameState.player2.name === 'Computer' && this.gameState.current_turn === 'Computer') {
                setTimeout(() => this.simulateComputerTurn(), 1000);
            }
        } catch (error) {
            showAlert(error.message, 'error');
        }
    }

    handleTouchStart(e) {
        e.preventDefault();
        if (this.gameState.current_turn !== this.getCurrentPlayerName()) return;
        
        const card = e.target.closest('.card');
        if (card) {
            this.handleCardSelect(card);
            if (this.selectedCard) {
                card.classList.add('being-dragged');
                this.touchStartX = e.touches[0].clientX;
                this.touchStartY = e.touches[0].clientY;
            }
        }
    }

    handleTouchMove(e) {
        if (!this.selectedCard) return;
        e.preventDefault();
        
        const touch = e.touches[0];
        const movingCard = document.querySelector('.being-dragged');
        if (movingCard) {
            const deltaX = touch.clientX - this.touchStartX;
            const deltaY = touch.clientY - this.touchStartY;
            
            movingCard.style.transform = `translate(${deltaX}px, ${deltaY}px)`;
            movingCard.style.position = 'fixed';
            movingCard.style.zIndex = '1000';

            // Highlight valid drop targets
            const elemBelow = document.elementFromPoint(touch.clientX, touch.clientY);
            const cell = elemBelow?.closest('.cell');
            
            document.querySelectorAll('.cell').forEach(c => c.classList.remove('valid-target'));
            if (cell && !cell.querySelector('.card')) {
                cell.classList.add('valid-target');
            }
        }
    }

    handleTouchEnd(e) {
        e.preventDefault();
        const movingCard = document.querySelector('.being-dragged');
        if (!movingCard || !this.selectedCard) return;

        const touch = e.changedTouches[0];
        const elemBelow = document.elementFromPoint(touch.clientX, touch.clientY);
        const cell = elemBelow?.closest('.cell');

        movingCard.style.transform = '';
        movingCard.style.position = '';
        movingCard.classList.remove('being-dragged');

        if (cell) {
            const row = parseInt(cell.dataset.row);
            const col = parseInt(cell.dataset.col);
            this.handleCardPlace(row, col);
        }

        document.querySelectorAll('.cell').forEach(c => c.classList.remove('valid-target'));
    }

    async handleCardPlace(row, col) {
        if (!this.selectedCard) return;
        if (this.gameState.current_turn !== this.getCurrentPlayerName()) {
            showAlert("It's not your turn!", 'error');
            return;
        }

        const isCharacterCard = this.selectedCard.type === 'CharacterCard';
        const isSpecialCard = this.selectedCard.type === 'ActionCard' || this.selectedCard.type === 'EffectCard';

        // Check if player has already played their cards for this turn
        if (isCharacterCard && this.gameState.player1.has_played_character) {
            showAlert("You've already played a character card this turn!", 'error');
            return;
        }
        if (isSpecialCard && this.gameState.player1.has_played_special) {
            showAlert("You've already played a special card this turn!", 'error');
            return;
        }

        try {
            const response = await fetch('/play_card', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    match_id: this.matchId,
                    card: this.selectedCard,
                    row: row,
                    col: col
                })
            });

            const data = await response.json();
            if (!response.ok) {
                throw new Error(data.error || 'Failed to play card');
            }

            this.gameState = data;
            this.selectedCard = null;
            
            // Clear selection
            document.querySelectorAll('.card.selected').forEach(card => {
                card.classList.remove('selected');
            });

            this.renderGameState();

            // Automatically end turn after placing a character card
            if (isCharacterCard) {
                this.announceTurn(this.gameState.current_turn);
                await this.endTurn();
            }

        } catch (error) {
            showAlert(error.message, 'error');
        }
    }

    // Add a method to announce turns
    announceTurn(playerName) {
        const turnAnnouncement = document.createElement('div');
        turnAnnouncement.className = 'turn-announcement';
        turnAnnouncement.textContent = `${playerName} Turn`;
        document.body.appendChild(turnAnnouncement);
        
        // Fade out and remove after animation
        setTimeout(() => {
            turnAnnouncement.classList.add('fade-out');
            setTimeout(() => {
                document.body.removeChild(turnAnnouncement);
            }, 1000);
        }, 2000);
    }

    canPlayCharacter() {
        const currentPlayer = this.getCurrentPlayer();
        return !currentPlayer.has_played_character;
    }

    canPlaySpecial() {
        const currentPlayer = this.getCurrentPlayer();
        return !currentPlayer.has_played_special;
    }

    getCurrentPlayer() {
        return this.gameState.player1.name === this.getCurrentPlayerName() 
            ? this.gameState.player1 
            : this.gameState.player2;
    }

    // Add animation methods
    animateCardPlacement(cardEl, targetRow, targetCol) {
        const rect = cardEl.getBoundingClientRect();
        const startX = rect.left;
        const startY = rect.top;
        
        const targetCell = document.querySelector(`.cell[data-row="${targetRow}"][data-col="${targetCol}"]`);
        const targetRect = targetCell.getBoundingClientRect();
        const targetX = targetRect.left + (targetRect.width - rect.width) / 2;
        const targetY = targetRect.top + (targetRect.height - rect.height) / 2;
        
        const clone = cardEl.cloneNode(true);
        clone.style.position = 'fixed';
        clone.style.left = startX + 'px';
        clone.style.top = startY + 'px';
        clone.style.zIndex = '1000';
        clone.style.transition = 'all 0.5s ease';
        document.body.appendChild(clone);
        
        // Start the animation
        setTimeout(() => {
            clone.style.left = targetX + 'px';
            clone.style.top = targetY + 'px';
            
            // Remove clone after animation
            setTimeout(() => {
                document.body.removeChild(clone);
            }, 500);
        }, 50);
    }
    
    animateCardFlip(cardEl) {
        return new Promise((resolve) => {
            cardEl.classList.add('flipping');
            
            // Use a transition to flip the card smoothly
            setTimeout(() => {
                cardEl.classList.add('flipped');
                
                // Wait for the animation to complete
                setTimeout(() => {
                    cardEl.classList.remove('flipping');
                    
                    // Update the owner indicator on the card
                    const currentOwner = cardEl.dataset.owner;
                    const newOwner = currentOwner === 'player1' ? 'player2' : 'player1';
                    cardEl.dataset.owner = newOwner;
                    
                    // Update the footer to show new ownership
                    const cardFooter = cardEl.querySelector('.card-footer');
                    if (cardFooter) {
                        cardFooter.textContent = `Owned by: ${newOwner}`;
                    }
                    
                    // Play a capture sound
                    this.playSound('capture');
                    
                    resolve();
                }, 500); // Match this to the CSS transition duration
            }, 50);
        });
    }

    animateCardCapture(cardEl) {
        return new Promise((resolve) => {
            cardEl.classList.add('capturing');
            
            // Use a transition to capture the card smoothly
            setTimeout(() => {
                cardEl.classList.add('captured');
                
                // Wait for the animation to complete
                setTimeout(() => {
                    cardEl.classList.remove('capturing');
                    
                    // Update the owner indicator on the card
                    const currentOwner = cardEl.dataset.owner;
                    const newOwner = currentOwner === 'player1' ? 'player2' : 'player1';
                    cardEl.dataset.owner = newOwner;
                    
                    // Update the footer to show new ownership
                    const cardFooter = cardEl.querySelector('.card-footer');
                    if (cardFooter) {
                        cardFooter.textContent = `Owned by: ${newOwner}`;
                    }
                    
                    // Play a capture sound
                    this.playSound('capture');
                    
                    resolve();
                }, 500); // Match this to the CSS transition duration
            }, 50);
        });
    }

    async processCaptures(playedCardPosition, playedCard) {
        const [row, col] = playedCardPosition;
        const directions = [
            [-1, 0], // Up
            [1, 0],  // Down
            [0, -1], // Left
            [0, 1]   // Right
        ];
        
        // Map directions to elements they compare
        const directionToElement = {
            '[-1,0]': 'Water',  // Up direction - Water element
            '[1,0]': 'Fire',    // Down direction - Fire element
            '[0,-1]': 'Air',    // Left direction - Air element
            '[0,1]': 'Earth'    // Right direction - Earth element
        };
        
        const captures = [];
        
        for (const direction of directions) {
            const [dRow, dCol] = direction;
            const adjacentRow = row + dRow;
            const adjacentCol = col + dCol;
            
            // Skip if adjacent position is out of bounds
            if (adjacentRow < 0 || adjacentRow >= 3 || 
                adjacentCol < 0 || adjacentCol >= 5) {
                continue;
            }
            
            const adjacentCard = this.gameState.grid[adjacentRow][adjacentCol];
            
            // Skip if there's no card in the adjacent position
            if (!adjacentCard || adjacentCard.type !== 'CharacterCard') {
                continue;
            }
            
            // Skip if the adjacent card belongs to the same player
            if (adjacentCard.owner === playedCard.owner) {
                continue;
            }
            
            // Get the element to compare based on direction
            const dirKey = `[${dRow},${dCol}]`;
            const elementType = directionToElement[dirKey];
            
            if (!elementType) {
                console.error(`Could not find element mapping for direction: ${dirKey}`);
                continue;
            }
            
            // Compare the SAME element type between both cards (new requirement)
            // Only capture if player's element value is >= opponent's element value
            if (playedCard.elements[elementType] >= adjacentCard.elements[elementType]) {
                captures.push([adjacentRow, adjacentCol]);
                console.log(`Capturing card at [${adjacentRow}, ${adjacentCol}]. ${elementType}(${playedCard.elements[elementType]}) >= ${elementType}(${adjacentCard.elements[elementType]})`);
            } else {
                console.log(`Not capturing card at [${adjacentRow}, ${adjacentCol}]. ${elementType}(${playedCard.elements[elementType]}) < ${elementType}(${adjacentCard.elements[elementType]})`);
            }
        }
        
        // Process all the captures
        for (const capturePos of captures) {
            const [captureRow, captureCol] = capturePos;
            const capturedCard = this.gameState.grid[captureRow][captureCol];
            capturedCard.owner = playedCard.owner;
            capturedCard.is_captured = true;
            
            // Find the DOM element and animate the capture
            const cellElements = document.querySelectorAll('.cell');
            // Calculate the correct index based on the 5x3 grid
            const cellIndex = captureRow * 5 + captureCol;
            const cellElement = cellElements[cellIndex];
            
            if (cellElement) {
                const cardEl = cellElement.querySelector('.card');
                if (cardEl) {
                    await this.animateCardCapture(cardEl);
                    
                    // Update the card appearance to show the new owner
                    cardEl.classList.remove('owner-opponent');
                    cardEl.classList.add('owner-self');
                    
                    // Update the footer to show new ownership
                    const cardFooter = cardEl.querySelector('.card-footer');
                    if (cardFooter) {
                        cardFooter.textContent = `Owned by: ${capturedCard.owner}`;
                    }
                }
            }
        }
        
        // Play capture sound if any cards were captured
        if (captures.length > 0) {
            this.playSound('capture');
        }
        
        return captures.length > 0;
    }

    // Add a sound playing method
    playSound(soundName) {
        if (this.sounds[soundName]) {
            // Stop the sound if it's already playing
            this.sounds[soundName].pause();
            this.sounds[soundName].currentTime = 0;
            
            // Play the sound
            this.sounds[soundName].play().catch(error => {
                console.log('Error playing sound:', error);
            });
        }
    }

    checkGameOver() {
        // Check if the grid is full or if a player has no cards left
        let boardFull = true;
        let totalCards = 0;
        let player1Cards = 0;
        let player2Cards = 0;
        
        for (let row = 0; row < this.gameState.grid.length; row++) {
            for (let col = 0; col < this.gameState.grid[row].length; col++) {
                const card = this.gameState.grid[row][col];
                if (!card) {
                    boardFull = false;
                } else if (card.type === 'CharacterCard') {
                    totalCards++;
                    if (card.owner === this.gameState.player1.name) {
                        player1Cards++;
                    } else if (card.owner === this.gameState.player2.name) {
                        player2Cards++;
                    }
                }
            }
        }
        
        // Check if any player has no cards on the board
        if (totalCards > 0 && (player1Cards === 0 || player2Cards === 0)) {
            this.announceWinner();
            return true;
        }
        
        // Check if the board is full
        if (boardFull) {
            this.announceWinner();
            return true;
        }
        
        return false;
    }
    
    announceWinner() {
        if (!this.gameState.final_scores) {
            return;
        }

        const scores = this.gameState.final_scores;
        const player1Score = scores.player1.cards;
        const player2Score = scores.player2.cards;
        
        let title, message;
        
        if (player1Score === player2Score) {
            title = "It's a Tie!";
            message = `Both players have ${player1Score} cards in the Arena!`;
        } else {
            const winner = player1Score > player2Score ? scores.player1 : scores.player2;
            const loser = player1Score > player2Score ? scores.player2 : scores.player1;
            const isCurrentPlayerWinner = winner.name === this.currentPlayerName;
            
            title = isCurrentPlayerWinner ? 'Victory!' : 'Defeat';
            message = `${winner.name} wins with ${Math.max(player1Score, player2Score)} cards in the Arena vs ${loser.name}'s ${Math.min(player1Score, player2Score)} cards!`;
        }
        
        this.showGameOverModal(title, message);
    }
    
    showGameOverModal(title, message) {
        // Remove any existing game over or rematch modals
        document.querySelector('.winner-announcement')?.remove();
        document.querySelector('.rematch-request-modal')?.remove();
        
        // Create the winner announcement modal
        const winnerAnnouncement = document.createElement('div');
        winnerAnnouncement.className = 'winner-announcement';
        
        // Get final scores if available
        const finalScores = this.gameState.final_scores;
        let scoreMessage = '';
        if (finalScores) {
            scoreMessage = `
                <div class="final-scores">
                    <div class="score-detail">
                        <strong>${finalScores.player1.name}</strong>: ${finalScores.player1.cards} cards in Arena
                    </div>
                    <div class="score-detail">
                        <strong>${finalScores.player2.name}</strong>: ${finalScores.player2.cards} cards in Arena
                    </div>
                </div>
            `;
        }
        
        // Create action buttons based on game type
        let actionButtons = '';
        if (this.gameState.player2.name === 'Computer') {
            // Single player options
            actionButtons = `
                <div class="game-over-actions">
                    <button class="btn btn-primary" onclick="window.gameClient.requestRematch()">Play Again</button>
                    <button class="btn btn-secondary" onclick="window.location.href='/lobby'">Return to Lobby</button>
                </div>
            `;
        } else {
            // Multiplayer options
            actionButtons = `
                <div class="game-over-actions">
                    <button class="btn btn-primary" onclick="window.gameClient.requestRematch()">Request Rematch</button>
                    <button class="btn btn-secondary" onclick="window.gameClient.findNewGame()">Find New Game</button>
                    <button class="btn btn-secondary" onclick="window.location.href='/lobby'">Return to Lobby</button>
                </div>
            `;
        }
        
        winnerAnnouncement.innerHTML = `
            <div class="winner-content">
                <h2>${title}</h2>
                <p>${message}</p>
                ${scoreMessage}
                ${actionButtons}
            </div>
        `;
        
        document.body.appendChild(winnerAnnouncement);
    }

    requestRematch() {
        if (this.gameState.player2.name === 'Computer') {
            // Start new game immediately for single player
            window.location.reload();
        } else {
            // Remove any existing modals
            document.querySelector('.rematch-request-modal')?.remove();
            
            // Send rematch request to opponent
            this.socket.emit('rematch_request', {
                match_id: this.matchId
            });
            
            // Show waiting message
            this.showRematchRequestSent();
        }
    }

    showRematchRequestSent() {
        const modal = document.querySelector('.winner-content');
        if (modal) {
            const actions = modal.querySelector('.game-over-actions');
            if (actions) {
                actions.innerHTML = `
                    <div class="waiting-message">
                        <p>Waiting for opponent to accept rematch...</p>
                        <button class="btn btn-secondary" onclick="window.gameClient.cancelRematchRequest()">Cancel</button>
                    </div>
                `;
            }
        }
    }

    handleRematchRequest(data) {
        // Remove any existing modals
        document.querySelector('.rematch-request-modal')?.remove();
        
        const modal = document.createElement('div');
        modal.className = 'rematch-request-modal';
        modal.innerHTML = `
            <div class="modal-content">
                <h3>Rematch Request</h3>
                <p>${data.requester} wants to play again!</p>
                <div class="modal-actions">
                    <button class="btn btn-primary" onclick="window.gameClient.acceptRematch('${data.match_id}')">Accept</button>
                    <button class="btn btn-secondary" onclick="window.gameClient.declineRematch('${data.match_id}')">Decline</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }

    acceptRematch(matchId) {
        this.socket.emit('accept_rematch', {
            match_id: matchId
        });
        document.querySelector('.rematch-request-modal')?.remove();
    }

    declineRematch(matchId) {
        this.socket.emit('decline_rematch', {
            match_id: matchId
        });
        document.querySelector('.rematch-request-modal')?.remove();
        window.location.href = '/lobby';
    }

    cancelRematchRequest() {
        this.socket.emit('cancel_rematch_request', {
            match_id: this.matchId
        });
        window.location.href = '/lobby';
    }

    findNewGame() {
        // Remove existing game over modal
        document.querySelector('.winner-announcement')?.remove();
        
        // Show searching message
        const searchingModal = document.createElement('div');
        searchingModal.className = 'searching-modal';
        searchingModal.innerHTML = `
            <div class="modal-content">
                <h3>Searching for new game...</h3>
                <div class="spinner"></div>
                <button class="btn btn-secondary" onclick="window.location.href='/lobby'">Cancel</button>
            </div>
        `;
        document.body.appendChild(searchingModal);
        
        // Emit matchmaking event
        this.socket.emit('find_match');
    }
}

// Initialize the game when the page loads
document.addEventListener('DOMContentLoaded', () => {
    const matchId = document.querySelector('[data-match-id]').dataset.matchId;
    window.gameClient = new GameClient(matchId);
});