class LobbyClient {
    constructor() {
        // Initialize quotes first
        this.initializeGreeting();
        
        // Then setup other functionality
        this.socket = io();
        this.bindEvents();
        this.setupSocketListeners();
        this.updateOnlinePlayers();
        this.isSearching = false;
        this.currentChatPartner = null;
        this.currentProfile = null;
        this.bindAdditionalEvents();
        this.loadQuests();
    }

    bindEvents() {
        // Game mode buttons
        document.getElementById('vs-computer').addEventListener('click', () => this.startComputerGame());
        document.getElementById('vs-player').querySelector('button').addEventListener('click', () => this.findMatch());
        document.getElementById('cancelMatchBtn').addEventListener('click', () => this.cancelMatchmaking());

        // Update online players list periodically
        setInterval(() => this.updateOnlinePlayers(), 30000);

        // Quest-related events
        document.getElementById('refreshQuests')?.addEventListener('click', () => this.refreshQuests());
        document.getElementById('claimRewardBtn')?.addEventListener('click', () => this.claimQuestReward());
    }

    bindAdditionalEvents() {
        // Profile modal events
        document.addEventListener('click', (e) => {
            if (e.target.closest('.player-item')) {
                const playerName = e.target.closest('.player-item').dataset.username;
                this.showPlayerProfile(playerName);
            }
        });

        document.querySelector('.modal-close')?.addEventListener('click', () => {
            document.getElementById('profileModal').classList.remove('active');
        });

        // Chat events
        document.getElementById('chatSelect').addEventListener('change', (e) => {
            this.setCurrentChatPartner(e.target.value);
        });

        document.getElementById('sendChat').addEventListener('click', () => this.sendChatMessage());
        document.getElementById('chatText').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.sendChatMessage();
        });
    }

    setupSocketListeners() {
        this.socket.on('match_found', (data) => {
            this.isSearching = false;
            document.getElementById('matchModal').classList.remove('active');
            this.handleMatchFound(data);
        });

        this.socket.on('matchmaking_cancelled', () => {
            this.isSearching = false;
            document.getElementById('matchModal').classList.remove('active');
            showAlert('Matchmaking cancelled', 'info');
        });

        this.socket.on('players_update', (data) => {
            this.updatePlayersList(data.players);
        });

        this.socket.on('matches_update', (data) => {
            this.updateMatchesList(data.matches);
        });

        // Handle connection events
        this.socket.on('connect', () => {
            showAlert('Connected to server', 'success');
        });

        this.socket.on('disconnect', () => {
            showAlert('Connection lost. Attempting to reconnect...', 'error');
        });

        this.socket.on('chat_message', (data) => {
            this.addChatMessage(data.from, data.message);
        });

        this.socket.on('challenge_received', (data) => {
            this.handleChallengeReceived(data);
        });

        this.socket.on('friend_request', (data) => {
            this.handleFriendRequest(data);
        });

        // Quest-related listeners
        this.socket.on('quest_progress', (data) => {
            this.updateQuestProgress(data);
        });

        this.socket.on('quest_completed', (data) => {
            this.showQuestCompleted(data);
        });
    }

    async startComputerGame() {
        try {
            const response = await fetch('/new_game', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    mode: 'computer'
                })
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.message || 'Failed to start game');
            }

            const data = await response.json();
            if (data.match_id) {
                window.location.href = `/game/${data.match_id}`;
            } else {
                throw new Error('No match ID received');
            }
        } catch (error) {
            showAlert(error.message || 'Failed to start game', 'error');
        }
    }

    findMatch() {
        if (this.isSearching) {
            return;
        }

        this.isSearching = true;
        document.getElementById('matchModal').classList.add('active');
        this.updateMatchmakingStatus('Searching for opponents...');
        this.socket.emit('find_match');

        // Add animation to the status message
        let dots = 0;
        this.matchmakingInterval = setInterval(() => {
            dots = (dots + 1) % 4;
            this.updateMatchmakingStatus('Searching for opponents' + '.'.repeat(dots));
        }, 500);
    }

    cancelMatchmaking() {
        if (!this.isSearching) {
            return;
        }

        this.socket.emit('cancel_matchmaking');
        this.isSearching = false;
        clearInterval(this.matchmakingInterval);
        document.getElementById('matchModal').classList.remove('active');
        showAlert('Matchmaking cancelled', 'info');
    }

    updateMatchmakingStatus(message) {
        const statusElement = document.getElementById('matchStatus');
        if (statusElement) {
            statusElement.textContent = message;
        }
    }

    handleMatchFound(data) {
        clearInterval(this.matchmakingInterval);
        showAlert(`Match found! Playing against ${data.opponent}`, 'success');
        setTimeout(() => {
            window.location.href = `/game/${data.match_id}`;
        }, 1500);
    }

    updatePlayersList(players) {
        const playersList = document.getElementById('playersList');
        if (!playersList) return;

        if (players.length === 0) {
            playersList.innerHTML = '<div class="no-players">No players online</div>';
            return;
        }

        playersList.innerHTML = players.map(player => `
            <div class="player-item" data-username="${player.username}">
                <div class="player-info">
                    <span class="status-dot ${player.status}"></span>
                    <span class="player-name">${player.username}</span>
                    <span class="player-rating">${player.rating}</span>
                </div>
                <div class="player-actions">
                    <button class="btn btn-small btn-primary challenge-btn">Challenge</button>
                    <button class="btn btn-small btn-secondary chat-btn">Chat</button>
                </div>
            </div>
        `).join('');

        // Update chat select options
        const chatSelect = document.getElementById('chatSelect');
        chatSelect.innerHTML = '<option value="">Select a player...</option>' +
            players.map(p => `<option value="${p.username}">${p.username}</option>`).join('');
    }

    updateMatchesList(matches) {
        const matchesList = document.getElementById('matchesList');
        if (!matchesList) return;

        if (matches.length === 0) {
            matchesList.innerHTML = '<div class="no-matches">No active matches</div>';
            return;
        }

        matchesList.innerHTML = matches.map(match => `
            <div class="match-item">
                <div class="match-players">
                    <span>${match.player1}</span>
                    <span class="vs">vs</span>
                    <span>${match.player2}</span>
                </div>
                <span class="match-status ${match.status.toLowerCase()}">${match.status}</span>
            </div>
        `).join('');
    }

    updateOnlinePlayers() {
        fetch('/api/online-players')
            .then(response => response.json())
            .then(data => this.updatePlayersList(data.players))
            .catch(error => console.error('Failed to fetch online players:', error));
    }

    async showPlayerProfile(username) {
        try {
            const response = await fetch(`/api/player/${username}`);
            const data = await response.json();
            
            const modal = document.getElementById('profileModal');
            modal.classList.add('active');
            
            modal.querySelector('.player-profile-name').textContent = username;
            modal.querySelector('.rating').textContent = data.rating;
            modal.querySelector('.games-won').textContent = data.games_won;
            modal.querySelector('.win-rate').textContent = 
                `${((data.games_won / data.games_played) * 100).toFixed(1)}%`;

            const historyList = modal.querySelector('.match-history-list');
            historyList.innerHTML = data.match_history.map(match => `
                <div class="match-history-item ${match.result}">
                    <span class="opponent">${match.opponent}</span>
                    <span class="result">${match.result}</span>
                    <span class="date">${new Date(match.date).toLocaleDateString()}</span>
                </div>
            `).join('');

            this.currentProfile = username;
        } catch (error) {
            showAlert('Failed to load player profile', 'error');
        }
    }

    setCurrentChatPartner(username) {
        this.currentChatPartner = username;
        const chatMessages = document.getElementById('chatMessages');
        chatMessages.innerHTML = '';
        if (username) {
            this.loadChatHistory(username);
        }
    }

    async loadChatHistory(username) {
        try {
            const response = await fetch(`/api/chat/${username}`);
            const data = await response.json();
            
            const chatMessages = document.getElementById('chatMessages');
            chatMessages.innerHTML = data.messages.map(msg => this.formatChatMessage(msg)).join('');
            chatMessages.scrollTop = chatMessages.scrollHeight;
        } catch (error) {
            showAlert('Failed to load chat history', 'error');
        }
    }

    sendChatMessage() {
        const input = document.getElementById('chatText');
        const message = input.value.trim();
        
        if (!this.currentChatPartner || !message) return;
        
        this.socket.emit('chat_message', {
            to: this.currentChatPartner,
            message: message
        });
        
        this.addChatMessage('You', message);
        input.value = '';
    }

    addChatMessage(from, message) {
        const chatMessages = document.getElementById('chatMessages');
        chatMessages.insertAdjacentHTML('beforeend', this.formatChatMessage({
            from: from,
            message: message,
            timestamp: new Date()
        }));
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    formatChatMessage(msg) {
        const isMe = msg.from === 'You';
        return `
            <div class="chat-message ${isMe ? 'sent' : 'received'}">
                <div class="message-content">
                    <div class="message-text">${msg.message}</div>
                    <div class="message-meta">
                        <span class="message-from">${msg.from}</span>
                        <span class="message-time">${new Date(msg.timestamp).toLocaleTimeString()}</span>
                    </div>
                </div>
            </div>
        `;
    }

    // Quest-related methods
    async loadQuests() {
        try {
            const questsList = document.getElementById('questsList');
            if (!questsList) return;
            
            const response = await fetch('/api/quests');
            if (!response.ok) {
                throw new Error('Failed to load quests');
            }
            
            const data = await response.json();
            this.renderQuests(data.quests);
        } catch (error) {
            console.error('Failed to load quests:', error);
            document.getElementById('questsList').innerHTML = `
                <div class="error-message">Failed to load quests. 
                    <button class="btn btn-small btn-secondary" onclick="window.lobbyClient.refreshQuests()">
                        Try Again
                    </button>
                </div>
            `;
        }
    }
    
    async refreshQuests() {
        try {
            const refreshBtn = document.getElementById('refreshQuests');
            if (refreshBtn) {
                refreshBtn.style.pointerEvents = 'none';
                refreshBtn.classList.add('rotating');
            }
            
            document.getElementById('questsList').innerHTML = '<div class="loading-spinner"></div>';
            
            const response = await fetch('/api/quests/refresh', { method: 'POST' });
            if (!response.ok) {
                throw new Error('Failed to refresh quests');
            }
            
            const data = await response.json();
            this.renderQuests(data.quests);
            showAlert('Quests refreshed!', 'success');
        } catch (error) {
            console.error('Failed to refresh quests:', error);
            showAlert('Failed to refresh quests', 'error');
        } finally {
            const refreshBtn = document.getElementById('refreshQuests');
            if (refreshBtn) {
                refreshBtn.style.pointerEvents = 'auto';
                refreshBtn.classList.remove('rotating');
            }
        }
    }
    
    renderQuests(quests) {
        const questsList = document.getElementById('questsList');
        if (!questsList) return;
        
        if (!quests || quests.length === 0) {
            questsList.innerHTML = '<div class="no-quests">No quests available</div>';
            return;
        }
        
        questsList.innerHTML = quests.map(quest => {
            const progress = Math.min(100, (quest.current / quest.target) * 100);
            const isCompleted = quest.current >= quest.target && !quest.claimed;
            const isClaimed = quest.claimed;
            
            return `
                <div class="quest-item ${isCompleted ? 'completed' : ''} ${isClaimed ? 'claimed' : ''}" data-id="${quest.id}">
                    <div class="quest-header">
                        <div class="quest-title">${quest.title}</div>
                        <div class="quest-reward">
                            <span class="coin-icon">🪙</span> ${quest.reward}
                        </div>
                    </div>
                    <div class="quest-description">${quest.description}</div>
                    <div class="quest-progress">
                        <div class="progress-bar" style="width: ${progress}%"></div>
                    </div>
                    <div class="quest-progress-text">
                        <span>${quest.current} / ${quest.target}</span>
                        <span>${progress.toFixed(0)}%</span>
                    </div>
                    ${isCompleted ? `
                        <div class="quest-actions">
                            <button class="btn btn-small btn-primary claim-btn" data-id="${quest.id}">
                                Claim Reward
                            </button>
                        </div>
                    ` : ''}
                    ${isCompleted ? `
                        <div class="quest-complete">
                            <div class="complete-badge">COMPLETED</div>
                        </div>
                    ` : ''}
                    ${isClaimed ? `
                        <div class="quest-complete">
                            <div class="complete-badge">CLAIMED</div>
                        </div>
                    ` : ''}
                </div>
            `;
        }).join('');
        
        // Add event listeners for claim buttons
        document.querySelectorAll('.claim-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const questId = e.target.dataset.id;
                this.claimQuestReward(questId);
            });
        });
    }
    
    updateQuestProgress(data) {
        const questItem = document.querySelector(`.quest-item[data-id="${data.quest_id}"]`);
        if (!questItem) return;
        
        const progressBar = questItem.querySelector('.progress-bar');
        const progressText = questItem.querySelector('.quest-progress-text');
        
        const progress = Math.min(100, (data.current / data.target) * 100);
        progressBar.style.width = `${progress}%`;
        
        progressText.innerHTML = `
            <span>${data.current} / ${data.target}</span>
            <span>${progress.toFixed(0)}%</span>
        `;
        
        // Check if quest is completed
        if (data.current >= data.target && !questItem.classList.contains('completed')) {
            questItem.classList.add('completed');
            
            // Add claim button if not already there
            if (!questItem.querySelector('.claim-btn')) {
                const actionsDiv = document.createElement('div');
                actionsDiv.className = 'quest-actions';
                actionsDiv.innerHTML = `
                    <button class="btn btn-small btn-primary claim-btn" data-id="${data.quest_id}">
                        Claim Reward
                    </button>
                `;
                questItem.appendChild(actionsDiv);
                
                // Add complete badge
                const completeDiv = document.createElement('div');
                completeDiv.className = 'quest-complete';
                completeDiv.innerHTML = '<div class="complete-badge">COMPLETED</div>';
                questItem.appendChild(completeDiv);
                
                // Add event listener to the claim button
                questItem.querySelector('.claim-btn').addEventListener('click', (e) => {
                    this.claimQuestReward(data.quest_id);
                });
            }
        }
    }
    
    showQuestCompleted(data) {
        const modal = document.getElementById('questCompletedModal');
        const rewardSpan = document.getElementById('completedQuestReward');
        const titleSpan = document.getElementById('completedQuestTitle');
        
        rewardSpan.textContent = data.reward;
        titleSpan.textContent = data.title;
        
        modal.classList.add('active');
        
        // Store quest ID to be claimed
        this.completedQuestId = data.quest_id;
    }
    
    async claimQuestReward(questId = null) {
        try {
            const id = questId || this.completedQuestId;
            if (!id) return;
            
            const response = await fetch(`/api/quests/${id}/claim`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                }
            });
            
            if (!response.ok) {
                throw new Error('Failed to claim reward');
            }
            
            const data = await response.json();
            
            // Update coin display
            updateCoinDisplay(data.new_balance);
            
            // Show notification
            showCoinNotification(data.reward, `Claimed from quest: ${data.quest_title}`);
            
            // Update quest UI
            const questItem = document.querySelector(`.quest-item[data-id="${id}"]`);
            if (questItem) {
                questItem.classList.add('claimed');
                questItem.classList.remove('completed');
                
                // Replace "COMPLETED" with "CLAIMED"
                const completeDiv = questItem.querySelector('.quest-complete');
                if (completeDiv) {
                    completeDiv.innerHTML = '<div class="complete-badge">CLAIMED</div>';
                    completeDiv.style.opacity = '1';
                }
                
                // Remove claim button
                const claimBtn = questItem.querySelector('.claim-btn');
                if (claimBtn) {
                    claimBtn.parentElement.remove();
                }
            }
            
            // Close modal if open
            document.getElementById('questCompletedModal').classList.remove('active');
            
            showAlert('Reward claimed successfully!', 'success');
        } catch (error) {
            console.error('Failed to claim reward:', error);
            showAlert('Failed to claim reward', 'error');
        }
    }

    // User greeting and quotes functionality
    initializeGreeting() {
        // Set the personalized greeting
        this.setTimeBasedGreeting();
        
        // Set a random quote
        this.setRandomQuote();
    }
    
    setTimeBasedGreeting() {
        const greetingElement = document.getElementById('userGreeting');
        if (!greetingElement) return;
        
        const hour = new Date().getHours();
        let greeting = '';
        
        // Determine greeting based on time of day
        if (hour < 12) {
            greeting = 'Good morning';
        } else if (hour < 18) {
            greeting = 'Good afternoon';
        } else {
            greeting = 'Good evening';
        }
        
        // Get username from meta tag
        const usernameMeta = document.querySelector('meta[name="username"]');
        const username = usernameMeta ? usernameMeta.getAttribute('content') : 'Warrior';
        
        // Set the greeting text with the username
        greetingElement.textContent = `${greeting}, ${username}!`;
        
        // Add emoji based on time
        greetingElement.textContent += hour < 12 ? ' ☀️' : hour < 18 ? ' 🌤️' : ' 🌙';
    }
    
    setRandomQuote() {
        const quoteElement = document.getElementById('randomQuote');
        const authorElement = document.getElementById('quoteAuthor');
        
        if (!quoteElement || !authorElement) return;
        
        // Collection of gaming and strategy quotes
        const quotes = [
            { text: "In the game of strategy, the player who thinks ahead wins.", author: "Sun Tzu" },
            { text: "Every battle is won or lost before it's ever fought.", author: "Sun Tzu" },
            { text: "Strategy without tactics is the slowest route to victory. Tactics without strategy is the noise before defeat.", author: "Sun Tzu" },
            { text: "Supreme excellence consists of breaking the enemy's resistance without fighting.", author: "Sun Tzu" },
            { text: "Let your plans be dark and impenetrable as night, and when you move, fall like a thunderbolt.", author: "Sun Tzu" },
            { text: "The best player is not the one who wins the most, but the one who enjoys the game the most.", author: "Unknown" },
            { text: "Victory awaits those who have everything in order.", author: "Roald Amundsen" },
            { text: "No matter how good you get, there's always someone better. That's what keeps us playing.", author: "Unknown" },
            { text: "A champion is defined not by their wins but by how they can recover when they fall.", author: "Serena Williams" },
            { text: "It's not whether you get knocked down, it's whether you get up.", author: "Vince Lombardi" },
            { text: "One must learn to lose before learning to win.", author: "Ancient Proverb" },
            { text: "Victory belongs to the most persevering.", author: "Napoleon Bonaparte" },
            { text: "The more difficult the victory, the greater the happiness in winning.", author: "Pelé" },
            { text: "Champions keep playing until they get it right.", author: "Billie Jean King" },
            { text: "You miss 100% of the shots you don't take.", author: "Wayne Gretzky" },
            { text: "Talent wins games, but teamwork and intelligence win championships.", author: "Michael Jordan" },
            { text: "It's not about perfect. It's about effort.", author: "Jillian Michaels" },
            { text: "The difference between the impossible and the possible lies in determination.", author: "Tommy Lasorda" },
            { text: "Victory is in having done your best. If you've done your best, you've won.", author: "Billy Bowerman" },
            { text: "Success is no accident. It is hard work, perseverance, learning, studying, sacrifice.", author: "Pelé" },
            { text: "I've failed over and over again in my life. That's why I succeed.", author: "Michael Jordan" },
            { text: "The only way to prove you're a good sport is to lose.", author: "Ernie Banks" },
            { text: "If you can't outplay them, outwork them.", author: "Ben Hogan" },
            { text: "The more I practice, the luckier I get.", author: "Gary Player" },
            { text: "What you lack in talent can be made up with desire, hustle, and giving 110% all the time.", author: "Don Zimmer" },
            { text: "Never let success get to your head, never let failure get to your heart.", author: "Unknown" },
            { text: "The will to win is not nearly as important as the will to prepare to win.", author: "Bobby Knight" },
            { text: "The price of success is hard work, dedication to the job at hand.", author: "Vince Lombardi" },
            { text: "Excellence is not a singular act but a habit.", author: "Aristotle" },
            { text: "It ain't over 'til it's over.", author: "Yogi Berra" },
            { text: "The harder you work, the harder it is to surrender.", author: "Vince Lombardi" },
            { text: "Winning isn't everything, but wanting to win is.", author: "Vince Lombardi" },
            { text: "Pain is temporary. Quitting lasts forever.", author: "Lance Armstrong" },
            { text: "If you're afraid to fail, then you're probably going to fail.", author: "Kobe Bryant" },
            { text: "There are no shortcuts to any place worth going.", author: "Beverly Sills" },
            { text: "Today's preparation determines tomorrow's achievement.", author: "Unknown" },
            { text: "Victory has a thousand fathers, but defeat is an orphan.", author: "John F. Kennedy" },
            { text: "Success is where preparation and opportunity meet.", author: "Bobby Unser" },
            { text: "The expert in anything was once a beginner.", author: "Helen Hayes" },
            { text: "Hard work beats talent when talent doesn't work hard.", author: "Tim Notke" },
            { text: "Winners never quit, and quitters never win.", author: "Vince Lombardi" },
            { text: "If you can believe it, the mind can achieve it.", author: "Ronnie Lott" },
            { text: "It's not the size of the dog in the fight, but the size of the fight in the dog.", author: "Archie Griffin" },
            { text: "Set your goals high, and don't stop till you get there.", author: "Bo Jackson" },
            { text: "Gold medals aren't really made of gold. They're made of sweat, determination, and a hard-to-find alloy called guts.", author: "Dan Gable" },
            { text: "The five S's of sports training are: stamina, speed, strength, skill, and spirit.", author: "Ken Doherty" },
            { text: "Do you know what my favorite part of the game is? The opportunity to play.", author: "Mike Singletary" },
            { text: "If you fail to prepare, you're prepared to fail.", author: "Mark Spitz" },
            { text: "A trophy carries dust. Memories last forever.", author: "Mary Lou Retton" },
            { text: "You have to expect things of yourself before you can do them.", author: "Michael Jordan" },
            { text: "He who is not courageous enough to take risks will accomplish nothing in life.", author: "Muhammad Ali" },
            { text: "Number one is just to gain a passion for running. To love the morning, to love the trail, to love the pace on the track.", author: "Pat Tyson" },
            { text: "Most people give up just when they're about to achieve success.", author: "Ross Perot" },
            { text: "You were born to be a player. You were meant to be here.", author: "Herb Brooks" },
            { text: "When you've got something to prove, there's nothing greater than a challenge.", author: "Terry Bradshaw" },
            { text: "Never give up, never give in, and when the upper hand is ours, may we have the ability to handle the win with the dignity.", author: "Doug Williams" },
            { text: "One man practicing sportsmanship is far better than 50 preaching it.", author: "Knute Rockne" },
            { text: "The hardest skill to acquire in this sport is the one where you compete all out, give it all you have, and you are still getting beat no matter what you do.", author: "Dan Gable" },
            { text: "The principle is competing against yourself.", author: "Steve Young" },
            { text: "When the going gets tough, the tough get going.", author: "Joseph Kennedy" },
            { text: "Victory is fleeting. Losing is forever.", author: "Billie Jean King" },
            { text: "A champion is someone who gets up when they can't.", author: "Jack Dempsey" },
            { text: "Never underestimate the heart of a champion.", author: "Rudy Tomjanovich" },
            { text: "In strategy it is important to see distant things as if they were close and to take a distanced view of close things.", author: "Miyamoto Musashi" },
            { text: "When practicing strategy, think big. When practicing tactics, think small.", author: "Gary Ryan Blair" },
            { text: "Competition makes us faster. Collaboration makes us better.", author: "Fyrefly" },
            { text: "The goal isn't to live forever, the goal is to create something that will.", author: "Chuck Palahniuk" },
            { text: "The master has failed more times than the beginner has even tried.", author: "Stephen McCranie" },
            { text: "Every defeat is merely an opportunity to learn the ways of victory.", author: "Gaming Wisdom" },
            { text: "The world breaks everyone, and afterward, some are strong at the broken places.", author: "Ernest Hemingway" },
            { text: "A good player is always lucky.", author: "Jose Raul Capablanca" },
            { text: "In life, as in chess, forethought wins.", author: "Charles Buxton" },
            { text: "A player surprised is half beaten.", author: "Proverb" },
            { text: "Play the opening like a book, the middle game like a magician, and the endgame like a machine.", author: "Rudolf Spielmann" },
            { text: "Even after a bad game, there's always the next one.", author: "Unknown" },
            { text: "A strong player is not one who always wins, but one who turns defeats into lessons.", author: "Unknown" },
            { text: "The true competitor loves the game more than the victory.", author: "Unknown" }
        ];
        
        // Shuffle the quotes array using Fisher-Yates algorithm
        for (let i = quotes.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [quotes[i], quotes[j]] = [quotes[j], quotes[i]];
        }
        
        // Select the first quote from shuffled array
        const selectedQuote = quotes[0];
        
        // Display the quote and author
        quoteElement.textContent = `"${selectedQuote.text}"`;
        authorElement.textContent = `- ${selectedQuote.author}`;
    }
}

// Start the lobby client when the page loads
document.addEventListener('DOMContentLoaded', () => {
    window.lobbyClient = new LobbyClient();
});