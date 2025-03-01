# Smash&Clash

A strategic card battling game with real-time multiplayer, built with Flask and Socket.IO.

## Features

- 🎮 Real-time card battles with strategic gameplay
- 👥 Player vs Player and Player vs AI modes
- 🌟 Dynamic card effects and animations
- 💰 In-game currency (SmashCoins) and betting system
- 👥 Friend system and private messaging
- 📊 Rating system and matchmaking
- 🏆 Daily quests and achievements
- 💬 In-game chat system
- 🎨 Beautiful glass-morphic UI with particle effects

## Tech Stack

- Backend: Flask + Socket.IO
- Frontend: Vanilla JavaScript
- Database: SQLite
- Real-time Communication: Socket.IO
- Styling: Custom CSS with animations

## Setup

1. Clone the repository:
```bash
git clone [repository-url]
cd smash
```

2. Create and activate a virtual environment:
```bash
python -m venv venv
source venv/bin/activate  # For Linux/Mac
venv\Scripts\activate     # For Windows
```

3. Install dependencies:
```bash
pip install -r requirements.txt
```

4. Initialize the database:
```bash
flask db init
flask db migrate
flask db upgrade
```

5. Run the server:
```bash
python main.py
```

The game will be available at:
- Local: http://localhost:5000
- Network: http://[your-ip]:5000

## Game Rules

### Basics
- Players take turns placing character cards on a 3x5 grid
- Each character card has 4 elemental values (Fire, Water, Air, Earth)
- Cards can capture adjacent opponent cards by comparing matching elements

### Card Types
- **Character Cards**: Main cards with elemental values
- **Action Cards**: Special effects that modify gameplay
- **Effect Cards**: Provide ongoing bonuses

### Winning
- Game ends when the board is full
- Player with the most cards on the board wins
- Rating points and SmashCoins are awarded based on performance

## Development

### Project Structure
```
smash/
├── static/
│   ├── css/
│   │   └── style.css
│   ├── js/
│   │   ├── common.js
│   │   ├── game.js
│   │   └── lobby.js
│   └── sounds/
├── templates/
│   ├── base.html
│   ├── index.html
│   ├── lobby.html
│   ├── login.html
│   ├── profile.html
│   └── register.html
├── main.py
├── forms.py
└── requirements.txt
```

### Key Components
- **main.py**: Core game logic and server routes
- **game.js**: Client-side game mechanics
- **lobby.js**: Matchmaking and social features
- **style.css**: UI styling and animations

## Contributing

1. Fork the repository
2. Create your feature branch: `git checkout -b feature/your-feature`
3. Commit your changes: `git commit -m 'Add some feature'`
4. Push to the branch: `git push origin feature/your-feature`
5. Submit a pull request

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Acknowledgments

- Card game mechanics inspired by classical strategy games
- UI design influenced by modern glass-morphic trends
- Special thanks to all contributors and testers