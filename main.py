from flask import Flask, render_template, jsonify, request, session, flash, redirect, url_for
from flask_sqlalchemy import SQLAlchemy
from flask_login import LoginManager, UserMixin, login_user, login_required, logout_user, current_user
from flask_socketio import SocketIO, emit, join_room, leave_room
from werkzeug.security import generate_password_hash, check_password_hash
from datetime import datetime, timedelta
from forms import LoginForm, RegistrationForm
import random
import json
import socket
import os
from collections import defaultdict
import time

app = Flask(__name__)
app.secret_key = 'smash_and_clash_secret_key'  # Change this in production
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///smash_clash.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

db = SQLAlchemy(app)
login_manager = LoginManager()
login_manager.init_app(app)
login_manager.login_view = 'login'
socketio = SocketIO(app)

# Online players tracking
online_players = set()

# Add this after the online_players set
active_chats = defaultdict(set)  # Track active chat sessions

# Database Models
class User(UserMixin, db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    email = db.Column(db.String(120), unique=True, nullable=False)
    password_hash = db.Column(db.String(128))
    rating = db.Column(db.Integer, default=1000)
    games_played = db.Column(db.Integer, default=0)
    games_won = db.Column(db.Integer, default=0)
    smash_coins = db.Column(db.Integer, default=100)  # Starting coins

    def set_password(self, password):
        self.password_hash = generate_password_hash(password)

    def check_password(self, password):
        return check_password_hash(self.password_hash, password)

class Match(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    player1_id = db.Column(db.Integer, db.ForeignKey('user.id'))
    player2_id = db.Column(db.Integer, db.ForeignKey('user.id'))
    winner_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=True)
    started_at = db.Column(db.DateTime, default=datetime.utcnow)
    ended_at = db.Column(db.DateTime, nullable=True)
    game_state = db.Column(db.JSON)
    bet_amount = db.Column(db.Integer, default=0)  # Amount bet by each player
    bet_locked = db.Column(db.Boolean, default=False)  # Whether betting is locked

class ChatMessage(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    match_id = db.Column(db.Integer, db.ForeignKey('match.id'), nullable=True)
    sender_id = db.Column(db.Integer, db.ForeignKey('user.id'))
    receiver_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=True)
    message = db.Column(db.String(500))
    timestamp = db.Column(db.DateTime, default=datetime.utcnow)
    is_read = db.Column(db.Boolean, default=False)

class Friend(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'))
    friend_id = db.Column(db.Integer, db.ForeignKey('user.id'))
    status = db.Column(db.String(20), default='pending')  # pending, accepted, blocked
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

# Add relationships to User model
User.friends = db.relationship('Friend',
    primaryjoin="or_(User.id==Friend.user_id, User.id==Friend.friend_id)",
    lazy='dynamic')

User.sent_messages = db.relationship('ChatMessage',
    foreign_keys=[ChatMessage.sender_id],
    backref='sender',
    lazy='dynamic')

User.received_messages = db.relationship('ChatMessage',
    foreign_keys=[ChatMessage.receiver_id],
    backref='receiver',
    lazy='dynamic')

User.matches_as_player1 = db.relationship('Match',
    foreign_keys=[Match.player1_id],
    backref='player1',
    lazy='dynamic')

User.matches_as_player2 = db.relationship('Match',
    foreign_keys=[Match.player2_id],
    backref='player2',
    lazy='dynamic')

# Matchmaking system
class MatchmakingQueue:
    def __init__(self):
        self.queue = []
        self.matches = {}

    def add_player(self, player_id, rating):
        self.queue.append({'id': player_id, 'rating': rating, 'time': datetime.utcnow()})

    def remove_player(self, player_id):
        self.queue = [player for player in self.queue if player['id'] != player_id]

    def find_match(self):
        if len(self.queue) < 2:
            return None
        
        self.queue.sort(key=lambda x: (x['rating'], x['time']))
        
        for i, player1 in enumerate(self.queue):
            for player2 in self.queue[i+1:]:
                if abs(player1['rating'] - player2['rating']) <= 200:
                    match = Match(
                        player1_id=player1['id'],
                        player2_id=player2['id'],
                        started_at=datetime.utcnow()
                    )
                    db.session.add(match)
                    db.session.commit()
                    
                    self.queue.remove(player1)
                    self.queue.remove(player2)
                    
                    self.matches[match.id] = {
                        'player1': player1['id'],
                        'player2': player2['id']
                    }
                    
                    return match.id
        
        return None

matchmaking = MatchmakingQueue()

@login_manager.user_loader
def load_user(id):
    return User.query.get(int(id))

class Card:
    def __init__(self, name):
        self.name = name
        self.is_captured = False
        self.owner = None

    def to_json(self):
        return {
            'name': self.name,
            'is_captured': self.is_captured,
            'owner': self.owner,
            'type': self.__class__.__name__
        }

class CharacterCard(Card):
    def __init__(self, name, faction, fire, water, air, earth):
        super().__init__(name)
        self.faction = faction
        self.elements = {
            'Fire': fire,
            'Water': water,
            'Air': air,
            'Earth': earth
        }

    def to_json(self):
        data = super().to_json()
        data.update({
            'faction': self.faction,
            'elements': self.elements
        })
        return data

class ActionCard(Card):
    def __init__(self, name, effect_type, value):
        super().__init__(name)
        self.effect_type = effect_type
        self.value = value

    def to_json(self):
        data = super().to_json()
        data.update({
            'effect_type': self.effect_type,
            'value': self.value
        })
        return data

class EffectCard(Card):
    def __init__(self, name, element_bonuses, bonus_effect=None):
        super().__init__(name)
        self.element_bonuses = element_bonuses
        self.bonus_effect = bonus_effect

    def to_json(self):
        data = super().to_json()
        data.update({
            'element_bonuses': self.element_bonuses,
            'bonus_effect': self.bonus_effect
        })
        return data

class Player:
    def __init__(self, name, deck):
        self.name = name
        self.deck = deck
        self.hand = []
        self.discard_pile = []
        self.active_effect = None
        self.has_played_character = False
        self.has_played_special = False

    def draw_card(self):
        if not self.deck:
            if self.discard_pile:
                self.deck = self.discard_pile
                self.discard_pile = []
                random.shuffle(self.deck)
            else:
                return False
        card = self.deck.pop(0)
        if len(self.hand) < 10:
            self.hand.append(card)
            return True
        else:
            self.discard_pile.append(card)
            return False

    def draw_specific_cards(self, num_character, num_action):
        # Separate deck into character cards only
        character_cards = [c for c in self.deck if isinstance(c, CharacterCard)]
        
        # Make sure we have enough cards
        if len(character_cards) < num_character:
            random.shuffle(self.deck)
            character_cards = [c for c in self.deck if isinstance(c, CharacterCard)]
        
        # Draw specific number of character cards
        drawn_characters = character_cards[:num_character]
        
        # Remove drawn cards from deck
        for card in drawn_characters:
            self.deck.remove(card)
        
        # Add to hand
        self.hand.extend(drawn_characters)
        
        # Shuffle remaining deck
        random.shuffle(self.deck)
        return True

    def to_json(self):
        return {
            'name': self.name,
            'hand': [card.to_json() for card in self.hand],
            'deck_count': len(self.deck),
            'discard_count': len(self.discard_pile),
            'active_effect': self.active_effect.to_json() if self.active_effect else None
        }

class Game:
    def __init__(self, player1_name, player2_name):
        self.player1 = Player(player1_name, create_deck('Light'))
        self.player2 = Player(player2_name, create_deck('Dark'))
        self.grid = [[None for _ in range(5)] for _ in range(3)]
        self.current_turn = player1_name
        self.winner = None
        self.initialize_game()

    def initialize_game(self):
        # Deal starting hands - 5 character cards only
        self.player1.draw_specific_cards(5, 0)
        self.player2.draw_specific_cards(5, 0)

    @classmethod
    def from_json(cls, data):
        if not data:
            return None
        game = cls(data['player1']['name'], data['player2']['name'])
        
        # Clear initial hands since we'll rebuild them
        game.player1.hand = []
        game.player2.hand = []
        
        # Reconstruct player hands and active effects
        for player_data in [data['player1'], data['player2']]:
            player = game.player1 if player_data['name'] == game.player1.name else game.player2
            
            for card_data in player_data['hand']:
                if card_data.get('type') == 'CardBack':
                    continue
                
                if card_data['type'] == 'CharacterCard':
                    card = CharacterCard(
                        card_data['name'],
                        card_data['faction'],
                        card_data['elements']['Fire'],
                        card_data['elements']['Water'],
                        card_data['elements']['Air'],
                        card_data['elements']['Earth']
                    )
                elif card_data['type'] == 'ActionCard':
                    card = ActionCard(
                        card_data['name'],
                        card_data['effect_type'],
                        card_data['value']
                    )
                elif card_data['type'] == 'EffectCard':
                    card = EffectCard(
                        card_data['name'],
                        card_data['element_bonuses'],
                        card_data.get('bonus_effect')
                    )
                player.hand.append(card)

        # Set game state
        game.current_turn = data['current_turn']
        game.winner = data.get('winner')

        # Reconstruct grid
        for row in range(3):
            for col in range(5):
                card_data = data['grid'][row][col]
                if card_data:
                    if card_data['type'] == 'CharacterCard':
                        card = CharacterCard(
                            card_data['name'],
                            card_data['faction'],
                            card_data['elements']['Fire'],
                            card_data['elements']['Water'],
                            card_data['elements']['Air'],
                            card_data['elements']['Earth']
                        )
                    elif card_data['type'] == 'ActionCard':
                        card = ActionCard(
                            card_data['name'],
                            card_data['effect_type'],
                            card_data['value']
                        )
                    elif card_data['type'] == 'EffectCard':
                        card = EffectCard(
                            card_data['name'],
                            card_data['element_bonuses'],
                            card_data.get('bonus_effect')
                        )
                    else:
                        continue
                        
                    card.is_captured = card_data['is_captured']
                    card.owner = card_data['owner']
                    game.grid[row][col] = card

        return game

    def to_json(self):
        data = {
            'player1': self.player1.to_json(),
            'player2': self.player2.to_json(),
            'grid': [[card.to_json() if card else None for card in row] for row in self.grid],
            'current_turn': self.current_turn,
            'winner': self.winner
        }
        
        # Include final scores if game is over
        if hasattr(self, 'final_scores'):
            data['final_scores'] = self.final_scores
            
        return data

    def check_duels(self, row, col, card):
        # Map (dx,dy) to the element to compare
        element_pairs = {
            (-1, 0): ('Fire', 'Fire'),     # Card above: our top Fire vs their bottom Fire
            (1, 0): ('Water', 'Water'),    # Card below: our bottom Water vs their top Water
            (0, -1): ('Earth', 'Earth'),   # Card to left: our left Earth vs their right Earth
            (0, 1): ('Air', 'Air')         # Card to right: our right Air vs their left Air
        }
        
        # Check all adjacent positions
        for dx, dy in [(-1, 0), (1, 0), (0, -1), (0, 1)]:  # up, down, left, right
            new_row, new_col = row + dx, col + dy
            if 0 <= new_row < 3 and 0 <= new_col < 5:
                opponent_card = self.grid[new_row][new_col]
                if opponent_card and isinstance(opponent_card, CharacterCard):
                    # Only check opponent's cards
                    if opponent_card.owner != card.owner:
                        our_element, their_element = element_pairs[(dx, dy)]
                        
                        # Compare the adjacent values
                        our_value = card.elements[our_element]
                        their_value = opponent_card.elements[their_element]
                        
                        # Only capture if our value is greater than or equal to their value
                        if our_value >= their_value:
                            opponent_card.owner = card.owner  # Change ownership
                            opponent_card.is_captured = False # Reset capture state
                        # If our value is less, do nothing - leave the card as is

    def check_winner(self):
        # Check if the board is full (15 cards)
        total_cards = sum(1 for row in self.grid for card in row if card)
        if total_cards == 15:  # 3x5 grid filled
            player1_cards = 0
            player2_cards = 0
            
            # Count total cards for each player
            for row in self.grid:
                for card in row:
                    if isinstance(card, CharacterCard):
                        if card.owner == self.player1.name:
                            player1_cards += 1
                        elif card.owner == self.player2.name:
                            player2_cards += 1
            
            # Determine winner based on total cards
            if player1_cards > player2_cards:
                self.winner = self.player1.name
            elif player2_cards > player1_cards:
                self.winner = self.player2.name
            else:
                self.winner = 'Tie'
            
            # Add the scores to the game state for the announcement
            self.final_scores = {
                'player1': {
                    'name': self.player1.name,
                    'cards': player1_cards
                },
                'player2': {
                    'name': self.player2.name,
                    'cards': player2_cards
                }
            }
            
            # Update player ratings if this is a multiplayer game
            if self.player2.name != 'Computer':
                self.update_player_ratings()
            
            self.running = False

        if self.winner:
            match = Match.query.filter_by(game_state=self.to_json()).first()
            if match:
                winner_id = match.player1_id if self.winner == self.player1.name else match.player2_id
                process_match_rewards(match, winner_id)

    def end_turn(self):
        current_player = self.player1 if self.current_turn == self.player1.name else self.player2
        
        # Reset turn flags
        current_player.has_played_character = False
        current_player.has_played_special = False
        
        # Draw card for next turn
        current_player.draw_card()
        
        # Check if this was the last turn (board is full)
        total_cards = sum(1 for row in self.grid for card in row if card)
        if total_cards == 15:  # Board is full
            self.check_winner()  # This will set the winner and final scores
            return
        
        # If not the last turn, switch turns normally
        self.current_turn = self.player2.name if self.current_turn == self.player1.name else self.player1.name

        # If next player is computer, trigger its turn
        if self.current_turn == 'Computer':
            self.play_computer_turn()

    def play_card(self, card_data, row, col, player_name):
        if self.current_turn != player_name:
            return False, "Not your turn"
        
        current_player = self.player1 if player_name == self.player1.name else self.player2
        
        # Find the actual card object from the card data
        card = None
        for hand_card in current_player.hand:
            if hand_card.name == card_data['name']:
                card = hand_card
                break
        
        if not card:
            return False, "Card not found in hand"
        
        # Check if it's a valid play
        if isinstance(card, CharacterCard):
            if self.grid[row][col] is not None:
                return False, "Cell is occupied"
                
            self.grid[row][col] = card
            card.owner = player_name
            current_player.hand.remove(card)
            current_player.has_played_character = True
            self.check_duels(row, col, card)
                
        elif isinstance(card, (ActionCard, EffectCard)):
            if not current_player.has_played_character:
                return False, "Must play a character card first"
                
            self.apply_special_card(card, current_player)
            current_player.hand.remove(card)
            current_player.has_played_special = True
            
        return True, "Card played successfully"

    def apply_special_card(self, card, player):
        if isinstance(card, ActionCard):
            if card.effect_type == 'boost':
                for row in self.grid:
                    for cell in row:
                        if isinstance(cell, CharacterCard) and cell.owner == player.name:
                            for element in cell.elements:
                                cell.elements[element] += card.value
            elif card.effect_type == 'extra_draw':
                for _ in range(card.value):
                    player.draw_card()
        elif isinstance(card, EffectCard):
            if player.active_effect:
                player.discard_pile.append(player.active_effect)
            player.active_effect = card

    def play_computer_turn(self):
        computer = self.player2
        
        # Try to play a character card first
        if not computer.has_played_character:
            character_cards = [c for c in computer.hand if isinstance(c, CharacterCard)]
            if character_cards:
                # Find first empty cell
                for row in range(3):
                    for col in range(5):
                        if self.grid[row][col] is None:
                            self.play_card(character_cards[0].to_json(), row, col, 'Computer')
                            # End turn after placing a character card
                            self.end_turn()
                            return
                    if computer.has_played_character:
                        break
        
        # End turn if no card was played
        self.end_turn()

    def update_player_ratings(self):
        try:
            # Get player records from database
            player1 = User.query.filter_by(username=self.player1.name).first()
            player2 = User.query.filter_by(username=self.player2.name).first()
            
            if not player1 or not player2:
                return
                
            # Calculate base K-factor based on games played
            def get_k_factor(games_played):
                if games_played < 10:
                    return 40  # Higher K-factor for new players
                elif games_played < 30:
                    return 32  # Standard K-factor
                else:
                    return 24  # Lower K-factor for experienced players
            
            k_factor1 = get_k_factor(player1.games_played)
            k_factor2 = get_k_factor(player2.games_played)
            k_factor = min(k_factor1, k_factor2)  # Use the lower K-factor
            
            # Calculate rating changes based on outcome
            if self.winner == self.player1.name:
                rating_change = self.calculate_rating_change(player1.rating, player2.rating, k_factor)
                player1.rating += rating_change
                player2.rating -= rating_change
                player1.games_won += 1
            elif self.winner == self.player2.name:
                rating_change = self.calculate_rating_change(player2.rating, player1.rating, k_factor)
                player2.rating += rating_change
                player1.rating -= rating_change
                player2.games_won += 1
            
            # Update games played
            player1.games_played += 1
            player2.games_played += 1
            
            # Ensure ratings don't go below 1
            player1.rating = max(1, player1.rating)
            player2.rating = max(1, player2.rating)
            
            db.session.commit()
        except Exception as e:
            print(f"Error updating ratings: {str(e)}")
            
    def calculate_rating_change(self, winner_rating, loser_rating, k_factor=32):
        # Using modified ELO rating system
        # Calculate expected score using ELO formula
        expected_score = 1 / (1 + 10 ** ((loser_rating - winner_rating) / 400))
        
        # Adjust K-factor based on rating difference
        rating_diff = abs(winner_rating - loser_rating)
        if rating_diff > 400:
            k_factor *= 1.5  # Increase K-factor for large rating differences
        elif rating_diff < 100:
            k_factor *= 0.8  # Decrease K-factor for small rating differences
        
        # Calculate base rating change
        rating_change = round(k_factor * (1 - expected_score))
        
        # Add bonus for beating higher-rated player
        if winner_rating < loser_rating:
            bonus = round((loser_rating - winner_rating) * 0.1)
            rating_change += min(bonus, 15)  # Cap bonus at 15 points
            
        return rating_change

def create_deck(faction):
    deck = []
    
    # Create character cards only
    for i in range(20):
        name = f"{faction} Creature {i+1}"
        if faction == 'Light':
            fire = random.randint(2, 5)
            water = random.randint(1, 4)
            air = random.randint(2, 5)
            earth = random.randint(1, 4)
        else:
            fire = random.randint(1, 4)
            water = random.randint(2, 5)
            air = random.randint(1, 4)
            earth = random.randint(2, 5)
        
        card = CharacterCard(name, faction, fire, water, air, earth)
        deck.append(card)
    
    random.shuffle(deck)
    return deck

# Routes
@app.route('/')
def index():
    if current_user.is_authenticated:
        return redirect(url_for('lobby'))
    form = LoginForm()
    return render_template('login.html', form=form)

@app.route('/lobby')
@login_required
def lobby():
    return render_template('lobby.html', username=current_user.username)

@app.route('/login', methods=['GET', 'POST'])
def login():
    if current_user.is_authenticated:
        return redirect(url_for('lobby'))
    
    form = LoginForm()
    if form.validate_on_submit():
        user = User.query.filter_by(username=form.username.data).first()
        if user and user.check_password(form.password.data):
            login_user(user, remember=form.remember_me.data)
            return redirect(url_for('lobby'))
        flash('Invalid username or password', 'error')
    return render_template('login.html', form=form)

@app.route('/register', methods=['GET', 'POST'])
def register():
    if current_user.is_authenticated:
        return redirect(url_for('lobby'))
    
    form = RegistrationForm()
    if form.validate_on_submit():
        if User.query.filter_by(username=form.username.data).first():
            flash('Username already exists', 'error')
            return render_template('register.html', form=form)
        
        user = User(
            username=form.username.data,
            email=form.email.data
        )
        user.set_password(form.password.data)
        db.session.add(user)
        db.session.commit()
        
        flash('Registration successful! Please login.', 'success')
        return redirect(url_for('login'))
    return render_template('register.html', form=form)

@app.route('/logout')
@login_required
def logout():
    logout_user()
    return redirect(url_for('index'))

@app.route('/profile')
@login_required
def profile():
    # Get user's match history with proper joins
    matches = Match.query.filter(
        (Match.player1_id == current_user.id) | (Match.player2_id == current_user.id)
    ).join(
        User, 
        (User.id == Match.player1_id) | (User.id == Match.player2_id)
    ).order_by(Match.started_at.desc()).limit(10).all()
    
    # Calculate win rate
    total_games = current_user.games_played
    win_rate = (current_user.games_won / total_games * 100) if total_games > 0 else 0
    
    return render_template('profile.html', 
        matches=matches,
        win_rate=win_rate
    )

@app.route('/update_profile', methods=['POST'])
@login_required
def update_profile():
    if request.method == 'POST':
        username = request.form.get('username')
        email = request.form.get('email')
        
        # Check if username is taken by another user
        if username != current_user.username:
            existing_user = User.query.filter_by(username=username).first()
            if existing_user:
                flash('Username already taken', 'error')
                return redirect(url_for('profile'))
        
        # Check if email is taken by another user
        if email != current_user.email:
            existing_user = User.query.filter_by(email=email).first()
            if existing_user:
                flash('Email already registered', 'error')
                return redirect(url_for('profile'))
        
        # Update user information
        current_user.username = username
        current_user.email = email
        
        try:
            db.session.commit()
            flash('Profile updated successfully', 'success')
        except Exception as e:
            db.session.rollback()
            flash('An error occurred while updating your profile', 'error')
        
        return redirect(url_for('profile'))

@app.route('/change_password', methods=['POST'])
@login_required
def change_password():
    if request.method == 'POST':
        current_password = request.form.get('current_password')
        new_password = request.form.get('new_password')
        confirm_password = request.form.get('confirm_password')
        
        # Verify current password
        if not current_user.check_password(current_password):
            flash('Current password is incorrect', 'error')
            return redirect(url_for('profile'))
        
        # Check if new passwords match
        if new_password != confirm_password:
            flash('New passwords do not match', 'error')
            return redirect(url_for('profile'))
        
        # Update password
        try:
            current_user.set_password(new_password)
            db.session.commit()
            flash('Password changed successfully', 'success')
        except Exception as e:
            db.session.rollback()
            flash('An error occurred while changing your password', 'error')
        
        return redirect(url_for('profile'))

# WebSocket events for matchmaking
@socketio.on('find_match')
def handle_find_match():
    try:
        if not current_user.is_authenticated:
            emit('game_error', {'message': 'You must be logged in to find a match'})
            return
            
        matchmaking.add_player(current_user.id, current_user.rating)
        match_id = matchmaking.find_match()
        
        if match_id:
            match = Match.query.get(match_id)
            player1 = User.query.get(match.player1_id)
            player2 = User.query.get(match.player2_id)
            
            emit('match_found', {
                'match_id': match_id,
                'opponent': player2.username
            }, room=str(player1.id))
            
            emit('match_found', {
                'match_id': match_id,
                'opponent': player1.username
            }, room=str(player2.id))
    except Exception as e:
        emit('game_error', {'message': str(e)})

@socketio.on('connect')
def handle_connect():
    if current_user.is_authenticated:
        online_players.add(current_user.id)
        join_room(str(current_user.id))
        emit('connection_success', {'message': 'Connected successfully'})
        
        # Notify friends that user is online
        notify_friends_status_change(current_user.id, 'online')

@socketio.on('disconnect')
def handle_disconnect():
    if current_user.is_authenticated:
        online_players.discard(current_user.id)
        leave_room(str(current_user.id))
        
        # Notify friends that user is offline
        notify_friends_status_change(current_user.id, 'offline')
        
        # Clear active chats
        active_chats.pop(current_user.id, None)

def notify_friends_status_change(user_id, status):
    # Get user's friends
    friends = Friend.query.filter(
        ((Friend.user_id == user_id) | (Friend.friend_id == user_id)) &
        (Friend.status == 'accepted')
    ).all()
    
    user = User.query.get(user_id)
    if not user:
        return
    
    # Notify each friend
    for friend in friends:
        friend_id = friend.friend_id if friend.user_id == user_id else friend.user_id
        socketio.emit('friend_status_change', {
            'username': user.username,
            'status': status
        }, room=str(friend_id))

@app.route('/api/chat/<username>')
@login_required
def get_chat_history(username):
    other_user = User.query.filter_by(username=username).first_or_404()
    
    # Check if they are friends
    friendship = Friend.query.filter(
        ((Friend.user_id == current_user.id) & (Friend.friend_id == other_user.id)) |
        ((Friend.user_id == other_user.id) & (Friend.friend_id == current_user.id)),
        Friend.status == 'accepted'
    ).first()
    
    if not friendship:
        return jsonify({'error': 'Not friends with this user'}), 403
    
    # Get chat history
    messages = ChatMessage.query.filter(
        ((ChatMessage.sender_id == current_user.id) & (ChatMessage.receiver_id == other_user.id)) |
        ((ChatMessage.sender_id == other_user.id) & (ChatMessage.receiver_id == current_user.id))
    ).order_by(ChatMessage.timestamp.desc()).limit(50).all()
    
    # Mark messages as read
    unread_messages = ChatMessage.query.filter_by(
        receiver_id=current_user.id,
        sender_id=other_user.id,
        is_read=False
    ).all()
    
    for msg in unread_messages:
        msg.is_read = True
    
    db.session.commit()
    
    return jsonify({
        'messages': [{
            'from': User.query.get(msg.sender_id).username,
            'message': msg.message,
            'timestamp': msg.timestamp.isoformat(),
            'is_read': msg.is_read
        } for msg in reversed(messages)]  # Reverse to show oldest first
    })

@socketio.on('private_message')
def handle_private_message(data):
    if not current_user.is_authenticated:
        return
    
    to_user = User.query.filter_by(username=data['to']).first()
    if not to_user:
        emit('chat_error', {'message': 'User not found'})
        return
    
    # Check if they are friends
    friendship = Friend.query.filter(
        ((Friend.user_id == current_user.id) & (Friend.friend_id == to_user.id)) |
        ((Friend.user_id == to_user.id) & (Friend.friend_id == current_user.id)),
        Friend.status == 'accepted'
    ).first()
    
    if not friendship:
        emit('chat_error', {'message': 'You must be friends to send messages'})
        return
    
    # Create and save message
    message = ChatMessage(
        sender_id=current_user.id,
        receiver_id=to_user.id,
        message=data['message'],
        is_read=str(to_user.id) in active_chats.get(current_user.id, set())
    )
    db.session.add(message)
    db.session.commit()
    
    # Send to recipient
    emit('private_message', {
        'from': current_user.username,
        'message': data['message'],
        'timestamp': message.timestamp.isoformat(),
        'is_read': message.is_read
    }, room=str(to_user.id))

@socketio.on('chat_opened')
def handle_chat_opened(data):
    if not current_user.is_authenticated:
        return
        
    other_user = User.query.filter_by(username=data['with']).first()
    if not other_user:
        return
        
    # Add to active chats
    active_chats[current_user.id].add(str(other_user.id))
    
    # Mark messages as read
    unread_messages = ChatMessage.query.filter_by(
        receiver_id=current_user.id,
        sender_id=other_user.id,
        is_read=False
    ).all()
    
    for msg in unread_messages:
        msg.is_read = True
    
    db.session.commit()
    
    # Notify sender that messages were read
    emit('messages_read', {
        'by': current_user.username
    }, room=str(other_user.id))

@socketio.on('chat_closed')
def handle_chat_closed(data):
    if not current_user.is_authenticated:
        return
        
    other_user = User.query.filter_by(username=data['with']).first()
    if not other_user:
        return
        
    # Remove from active chats
    active_chats[current_user.id].discard(str(other_user.id))

# Game routes
@app.route('/game/<match_id>')
@login_required
def game(match_id):
    match = Match.query.get_or_404(match_id)
    
    # Create new game state if not exists
    if not match.game_state:
        player1_name = User.query.get(match.player1_id).username
        player2_name = 'Computer' if match.player2_id is None else User.query.get(match.player2_id).username
        game = Game(player1_name, player2_name)
        match.game_state = game.to_json()
        db.session.commit()
    
    return render_template('index.html', match_id=match_id)

@app.route('/new_game', methods=['POST'])
@login_required
def new_game():
    try:
        data = request.get_json()
        game_mode = data.get('mode', 'player')
        player1_name = current_user.username
        player2_name = 'Computer' if game_mode == 'computer' else None
        
        # Create a new match in the database
        match = Match(
            player1_id=current_user.id,
            player2_id=None,  # None for computer opponent
            started_at=datetime.utcnow()
        )
        db.session.add(match)
        db.session.commit()
        
        # Initialize game state
        game = Game(player1_name, player2_name)
        match.game_state = game.to_json()
        db.session.commit()
        
        return jsonify({
            'match_id': match.id,
            'game_state': game.to_json()
        })
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500

@app.route('/play_card', methods=['POST'])
@login_required
def play_card():
    try:
        data = request.get_json()
        match = Match.query.get_or_404(data['match_id'])
        
        if not match.game_state:
            return jsonify({'error': 'Game not initialized'}), 400
        
        game = Game.from_json(match.game_state)
        if not game:
            return jsonify({'error': 'Invalid game state'}), 400
        
        success, message = game.play_card(
            data['card'],
            data['row'],
            data['col'],
            current_user.username
        )
        
        if not success:
            return jsonify({'error': message}), 400
        
        # Check if this was a character card that was played
        is_character_card = data['card'].get('type') == 'CharacterCard'
        
        # Automatically end the turn if a character card was played
        if is_character_card:
            game.end_turn()
        
        match.game_state = game.to_json()
        db.session.commit()
        
        # Check for game over
        game.check_winner()
        if game.winner:
            match.winner_id = current_user.id if game.winner == current_user.username else match.player2_id
            match.ended_at = datetime.utcnow()
            db.session.commit()
        
        # Emit game state update to both players
        if match.player2_id:
            socketio.emit('game_state_update', match.game_state, room=str(match.player1_id))
            socketio.emit('game_state_update', match.game_state, room=str(match.player2_id))
        
        return jsonify(game.to_json())
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/end_turn', methods=['POST'])
@login_required
def end_turn():
    game_state = session.get('game')
    if not game_state:
        return jsonify({'error': 'No active game'}), 400
    
    # Switch turns and reset turn flags
    game = Game.from_state(game_state)
    
    # Switch turn
    game.current_turn = game_state['player2']['name'] if game.current_turn == game_state['player1']['name'] else game_state['player1']['name']
    
    # Reset turn flags
    current_player = game.player1 if game.current_turn == game.player1.name else game.player2
    current_player.has_played_special = False
    current_player.has_played_character = False
    
    # Draw card for new turn
    current_player.draw_card()
    
    session['game'] = game.to_json()
    return jsonify(game.to_json())

@app.route('/computer_turn', methods=['POST'])
@login_required
def computer_turn():
    try:
        match = Match.query.get(session['match_id'])
        if not match.game_state:
            return jsonify({'error': 'No game state found'}), 400
        
        game = Game.from_json(match.game_state)
        if game.current_turn != 'Computer':
            return jsonify({'error': 'Not computer\'s turn'}), 400

        # AI logic for playing cards
        computer_player = game.player2
        
        # First try to play a character card first
        if not computer_player.has_played_character:
            character_cards = [c for c in computer_player.hand if isinstance(c, CharacterCard)]
            if character_cards:
                card_to_play = character_cards[0]  # Play first available character card
                # Find empty cell
                for row in range(3):
                    for col in range(5):
                        if game.grid[row][col] is None:
                            success, _ = game.play_card(character_to_play.to_json(), row, col, 'Computer')
                            if success:
                                break
                    if computer_player.has_played_character:
                        break

        # Then try to play an action/effect card
        if not computer_player.has_played_special:
            special_cards = [c for c in computer_player.hand if not isinstance(c, CharacterCard)]
            if special_cards:
                card_to_play = special_cards[0]
                game.play_card(card_to_play.to_json(), 0, 0, 'Computer')  # Row/col don't matter for special cards

        # End turn
        game.end_turn()
        
        # Update game state
        match.game_state = game.to_json()
        db.session.commit()
        
        return jsonify(game.to_json())
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/online-players')
def get_online_players_count():
    return jsonify({'count': len(online_players)})

@app.route('/api/live-matches')
def get_live_matches():
    # Get only active matches that are not finished
    active_matches = Match.query.filter(
        Match.ended_at.is_(None),
        Match.started_at >= (datetime.utcnow() - timedelta(minutes=30))  # Only show matches from last 30 minutes
    ).order_by(Match.started_at.desc()).limit(10).all()
    
    matches_data = []
    for match in active_matches:
        player1 = User.query.get(match.player1_id)
        player2 = User.query.get(match.player2_id)
        
        # Get current scores from game state
        game_state = match.game_state
        player1_score = 0
        player2_score = 0
        
        if game_state:
            # Count cards for each player
            for row in game_state['grid']:
                for card in row:
                    if card and card.get('owner') == player1.username:
                        player1_score += 1
                    elif card and card.get('owner') == player2.username:
                        player2_score += 1
        
        matches_data.append({
            'id': match.id,
            'player1': {
                'name': player1.username,
                'rating': player1.rating,
                'score': player1_score
            },
            'player2': {
                'name': player2.username,
                'rating': player2.rating,
                'score': player2_score
            },
            'started_at': match.started_at.isoformat(),
            'can_spectate': True
        })
    
    return jsonify({'matches': matches_data})

@app.route('/api/previous-matches')
def get_previous_matches():
    # Get completed matches from the last 24 hours
    previous_matches = Match.query.filter(
        Match.ended_at.isnot(None)
    ).order_by(Match.ended_at.desc()).limit(20).all()
    
    matches_data = []
    for match in previous_matches:
        player1 = User.query.get(match.player1_id)
        player2 = User.query.get(match.player2_id)
        winner = User.query.get(match.winner_id) if match.winner_id else None
        
        # Get final scores from game state
        game_state = match.game_state
        player1_score = 0
        player2_score = 0
        
        if game_state and 'final_scores' in game_state:
            player1_score = game_state['final_scores']['player1']['cards']
            player2_score = game_state['final_scores']['player2']['cards']
        
        matches_data.append({
            'id': match.id,
            'player1': {
                'name': player1.username,
                'rating': player1.rating,
                'score': player1_score
            },
            'player2': {
                'name': player2.username,
                'rating': player2.rating,
                'score': player2_score
            },
            'winner': winner.username if winner else 'Tie',
            'ended_at': match.ended_at.isoformat()
        })
    
    return jsonify({'matches': matches_data})

@socketio.on('join_as_spectator')
def handle_spectator_join(data):
    match_id = data.get('match_id')
    if not match_id:
        return
        
    match = Match.query.get(match_id)
    if not match:
        return
        
    # Join spectator room for this match
    join_room(f'match_{match_id}_spectators')
    
    # Send current game state to spectator
    emit('game_state_update', match.game_state)

@socketio.on('leave_as_spectator')
def handle_spectator_leave(data):
    match_id = data.get('match_id')
    if match_id:
        leave_room(f'match_{match_id}_spectators')

@app.route('/game/<match_id>/state')
@login_required
def get_game_state(match_id):
    match = Match.query.get_or_404(match_id)
    if not match.game_state:
        player1_name = User.query.get(match.player1_id).username
        player2_name = 'Computer' if match.player2_id is None else User.query.get(match.player2_id).username
        game = Game(player1_name, player2_name)
        match.game_state = game.to_json()
        db.session.commit()
    
    game_state = match.game_state.copy()
    is_player1 = current_user.id == match.player1_id
    current_player_name = User.query.get(match.player1_id).username if is_player1 else User.query.get(match.player2_id).username if match.player2_id else 'Computer'

    # Hide opponent's hand cards
    if is_player1:
        game_state['player2']['hand'] = [{'type': 'CardBack', 'name': 'Hidden Card'} for _ in range(len(game_state['player2']['hand']))]
    else:
        game_state['player1']['hand'] = [{'type': 'CardBack', 'name': 'Hidden Card'} for _ in range(len(game_state['player1']['hand']))]
    
    # Process grid cards
    for row in range(len(game_state['grid'])):
        for col in range(len(game_state['grid'][row])):
            card = game_state['grid'][row][col]
            if card:
                # Keep is_captured state but only hide stats for opponent's captured cards
                if card['is_captured'] and card['owner'] != current_player_name:
                    if card['type'] == 'CharacterCard':
                        game_state['grid'][row][col] = {
                            'type': card['type'],
                            'name': card['name'],
                            'is_captured': True,
                            'owner': card['owner'],
                            'faction': card.get('faction', ''),
                            'elements': {'Fire': '?', 'Water': '?', 'Air': '?', 'Earth': '?'}
                        }
    
    # Ensure consistent username handling in game state
    game_state['current_player'] = current_player_name
    
    return jsonify(game_state)

@app.route('/surrender', methods=['POST'])
@login_required
def surrender():
    if 'game' not in session or 'match_id' not in session:
        return jsonify({'error': 'No active game'}), 400
    
    match = Match.query.get(session['match_id'])
    if not match:
        return jsonify({'error': 'Match not found'}), 404
    
    # Update match result
    match.ended_at = datetime.utcnow()
    match.winner_id = match.player2_id if match.player1_id == current_user.id else match.player1_id
    
    # Update player stats
    current_user.games_played += 1
    opponent = User.query.get(match.winner_id)
    if opponent:
        opponent.games_played += 1
        opponent.games_won += 1
        
        # Update ratings
        rating_change = 20
        current_user.rating = max(1, current_user.rating - rating_change)
        opponent.rating += rating_change
    
    db.session.commit()
    
    # Clear game session
    session.pop('game', None)
    session.pop('match_id', None)
    
    return jsonify({'success': True})

@app.route('/api/player/<username>')
@login_required
def get_player_profile(username):
    player = User.query.filter_by(username=username).first_or_404()
    
    # Get match history
    matches = Match.query.filter(
        ((Match.player1_id == player.id) | (Match.player2_id == player.id)) &
        (Match.ended_at.isnot(None))
    ).order_by(Match.ended_at.desc()).limit(10).all()
    
    match_history = []
    for match in matches:
        opponent = User.query.get(match.player2_id if match.player1_id == player.id else match.player1_id)
        result = 'won' if match.winner_id == player.id else 'lost'
        match_history.append({
            'opponent': opponent.username,
            'result': result,
            'date': match.ended_at.isoformat()
        })
    
    return jsonify({
        'username': player.username,
        'rating': player.rating,
        'games_played': player.games_played,
        'games_won': player.games_won,
        'match_history': match_history
    })

@socketio.on('game_message')
def handle_game_message(data):
    if not current_user.is_authenticated:
        return
    
    match = Match.query.get(data['match_id'])
    if not match:
        return
    
    # Create chat message
    message = ChatMessage(
        match_id=match.id,
        sender_id=current_user.id,
        message=data['message']
    )
    db.session.add(message)
    db.session.commit()
    
    # Send to all players in the match
    for player_id in [match.player1_id, match.player2_id]:
        if player_id and player_id != current_user.id:
            socketio.emit('game_message', {
                'from': current_user.username,
                'message': data['message'],
                'timestamp': message.timestamp.isoformat()
            }, room=str(player_id))

@socketio.on('card_played')
def handle_card_played(data):
    try:
        if not current_user.is_authenticated:
            emit('game_error', {'message': 'You must be logged in to play cards'})
            return
            
        match = Match.query.get(data['match_id'])
        if not match:
            emit('game_error', {'message': 'Match not found'})
            return
            
        # Check if user is in this match
        if match.player1_id != current_user.id and match.player2_id != current_user.id:
            emit('game_error', {'message': 'You are not in this match'})
            return
            
        # Broadcast to the opponent
        opponent_id = match.player2_id if match.player1_id == current_user.id else match.player1_id
        if opponent_id:
            emit('card_played', {
                'card': data['card'],
                'row': data['row'],
                'col': data['col'],
                'gameState': match.game_state
            }, room=str(opponent_id))
    except Exception as e:
        emit('game_error', {'message': str(e)})

@socketio.on('card_flipped')
def handle_card_flipped(data):
    try:
        if not current_user.is_authenticated:
            emit('game_error', {'message': 'You must be logged in'})
            return
            
        match = Match.query.get(data['match_id'])
        if not match:
            emit('game_error', {'message': 'Match not found'})
            return
            
        # Check if user is in this match
        if match.player1_id != current_user.id and match.player2_id != current_user.id:
            emit('game_error', {'message': 'You are not in this match'})
            return
            
        # Update game state
        game = Game.from_json(match.game_state)
        row, col = data['row'], data['col']
        if 0 <= row < 3 and 0 <= col < 5 and game.grid[row][col]:
            game.grid[row][col].is_captured = True
            match.game_state = game.to_json()
            db.session.commit()
            
        # Broadcast to all players in the match
        emit('card_flipped', {
            'row': row,
            'col': col,
            'gameState': match.game_state
        }, room=str(match.player1_id))
        
        if match.player2_id:
            emit('card_flipped', {
                'row': row,
                'col': col,
                'gameState': match.game_state
            }, room=str(match.player2_id))
    except Exception as e:
        emit('game_error', {'message': str(e)})

@socketio.on('rematch_request')
def handle_rematch_request(data):
    try:
        if not current_user.is_authenticated:
            emit('game_error', {'message': 'You must be logged in'})
            return
            
        match = Match.query.get(data['match_id'])
        if not match:
            emit('game_error', {'message': 'Match not found'})
            return
            
        # Check if user is in this match
        if match.player1_id != current_user.id and match.player2_id != current_user.id:
            emit('game_error', {'message': 'You are not in this match'})
            return
            
        # Send request to opponent
        opponent_id = match.player2_id if match.player1_id == current_user.id else match.player1_id
        if opponent_id:
            emit('rematch_request', {
                'requester': current_user.username,
                'match_id': match.id
            }, room=str(opponent_id))
    except Exception as e:
        emit('game_error', {'message': str(e)})

@socketio.on('accept_rematch')
def handle_accept_rematch(data):
    try:
        match = Match.query.get(data['match_id'])
        if not match:
            emit('game_error', {'message': 'Match not found'})
            return
            
        # Create new match with same players
        new_match = Match(
            player1_id=match.player1_id,
            player2_id=match.player2_id,
            started_at=datetime.utcnow()
        )
        db.session.add(new_match)
        db.session.commit()
        
        # Notify both players
        emit('rematch_accepted', {'match_id': new_match.id}, room=str(match.player1_id))
        emit('rematch_accepted', {'match_id': new_match.id}, room=str(match.player2_id))
    except Exception as e:
        emit('game_error', {'message': str(e)})

@socketio.on('decline_rematch')
def handle_decline_rematch(data):
    try:
        match = Match.query.get(data['match_id'])
        if not match:
            return
            
        # Notify requester
        opponent_id = match.player2_id if match.player1_id == current_user.id else match.player1_id
        emit('rematch_declined', room=str(opponent_id))
    except Exception as e:
        emit('game_error', {'message': str(e)})

@socketio.on('cancel_rematch_request')
def handle_cancel_rematch(data):
    try:
        match = Match.query.get(data['match_id'])
        if not match:
            return
            
        # Notify opponent
        opponent_id = match.player2_id if match.player1_id == current_user.id else match.player1_id
        emit('rematch_cancelled', room=str(opponent_id))
    except Exception as e:
        emit('game_error', {'message': str(e)})

@socketio.on('place_bet')
def handle_place_bet(data):
    if not current_user.is_authenticated:
        emit('bet_error', {'message': 'You must be logged in to place bets'})
        return

    match = Match.query.get(data['match_id'])
    if not match:
        emit('bet_error', {'message': 'Match not found'})
        return

    # Check if user is in this match
    if match.player1_id != current_user.id and match.player2_id != current_user.id:
        emit('bet_error', {'message': 'You are not in this match'})
        return

    # Check if betting is still allowed (before half score)
    total_cards = sum(1 for row in match.game_state['grid'] for card in row if card)
    if total_cards >= 8:  # More than half the board is filled
        emit('bet_error', {'message': 'Betting is no longer allowed at this stage'})
        return

    # Check if betting is already locked
    if match.bet_locked:
        emit('bet_error', {'message': 'Betting is already locked for this match'})
        return

    bet_amount = data.get('amount', 0)
    if bet_amount <= 0:
        emit('bet_error', {'message': 'Invalid bet amount'})
        return

    # Check if player has enough coins
    if current_user.smash_coins < bet_amount:
        emit('bet_error', {'message': 'Not enough SmashCoins'})
        return

    # Update match bet amount
    match.bet_amount = bet_amount
    match.bet_locked = True
    
    # Lock the coins
    current_user.smash_coins -= bet_amount
    db.session.commit()

    # Notify both players
    emit('bet_placed', {
        'amount': bet_amount,
        'by': current_user.username
    }, room=str(match.player1_id))
    
    if match.player2_id:
        emit('bet_placed', {
            'amount': bet_amount,
            'by': current_user.username
        }, room=str(match.player2_id))

def process_match_rewards(match, winner_id):
    """Process rewards and bets after a match ends"""
    try:
        if match.player2_id is None or match.player2_id == 'Computer':  # AI match
            winner = User.query.get(winner_id)
            if winner and winner_id == match.player1_id:  # Player won against AI
                ai_reward = 10  # Reward for beating AI
                winner.smash_coins += ai_reward
                db.session.commit()
                
                # Notify winner about coins earned
                socketio.emit('coins_update', {
                    'coins': winner.smash_coins,
                    'earned': ai_reward,
                    'reason': 'You won against the computer!'
                }, room=str(winner_id))
        else:  # PvP match
            winner = User.query.get(winner_id)
            loser = User.query.get(match.player2_id if winner_id == match.player1_id else match.player1_id)
            
            if winner and loser:
                if match.bet_amount > 0:
                    total_bet = match.bet_amount * 2  # Both players bet the same amount
                    system_cut = int(total_bet * 0.3)  # 30% to system
                    winner_reward = total_bet - system_cut  # Remaining to winner
                    
                    winner.smash_coins += winner_reward
                    
                    # Notify winner about coins earned from bet
                    socketio.emit('coins_update', {
                        'coins': winner.smash_coins,
                        'earned': winner_reward,
                        'reason': 'You won the bet!'
                    }, room=str(winner_id))
                
                # Default win reward even without betting
                base_reward = 5
                winner.smash_coins += base_reward
                
                # Notify winner about base reward
                socketio.emit('coins_update', {
                    'coins': winner.smash_coins,
                    'earned': base_reward,
                    'reason': 'Base reward for winning'
                }, room=str(winner_id))
                
                # Small consolation prize for loser
                consolation = 2
                loser.smash_coins += consolation
                
                # Notify loser about consolation reward
                socketio.emit('coins_update', {
                    'coins': loser.smash_coins,
                    'earned': consolation,
                    'reason': 'Consolation prize'
                }, room=str(loser.id))
                
                db.session.commit()
    except Exception as e:
        print(f"Error processing match rewards: {str(e)}")

# Add route to get user's coin balance
@app.route('/api/coins')
@login_required
def get_coin_balance():
    return jsonify({
        'coins': current_user.smash_coins
    })

def get_local_ip():
    try:
        # Get the local IP address
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        local_ip = s.getsockname()[0]
        s.close()
        return local_ip
    except:
        return "127.0.0.1"

if __name__ == '__main__':
    port = 5000
    local_ip = get_local_ip()
    
    print("\n=== Smash&Clash Game Server ===")
    print(f"\nEnvironment: {os.getenv('FLASK_ENV', 'production')}")
    print(f"\nServer starting on port {port}")
    print("\nAccess the game at:")
    print(f"- Local computer: http://localhost:{port}")
    print(f"- Other devices on your network: http://{local_ip}:{port}")
    print("\nShare the network address with other players to let them join!")
    print("\nPress Ctrl+C to stop the server")
    print("\n=============================")
    
    with app.app_context():
        db.create_all()
    socketio.run(app, host='0.0.0.0', port=port, debug=True)