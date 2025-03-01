import os
from flask import Flask
from flask_sqlalchemy import SQLAlchemy
from main import app, db, User, Match, ChatMessage, Friend

def recreate_db():
    # Get the database file path
    db_path = app.config['SQLALCHEMY_DATABASE_URI'].replace('sqlite:///', '')
    
    # Remove the existing database file if it exists
    try:
        if os.path.exists(db_path):
            os.remove(db_path)
            print(f"Removed existing database at {db_path}")
    except Exception as e:
        print(f"Error removing database: {str(e)}")
    
    with app.app_context():
        # Create all tables with the new schema
        db.create_all()
        print("Created new database with updated schema")

if __name__ == '__main__':
    recreate_db() 