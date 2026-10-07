import os
import csv
import io
import random
from flask import Flask, render_template, request, jsonify, session, redirect, url_for
from models import db, User, Contact

app = Flask(__name__)
app.config['SECRET_KEY'] = 'contact-manager-secret-key-12345'
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///contact_manager.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

db.init_app(app)

with app.app_context():
    os.makedirs('instance', exist_ok=True)
    db.create_all()

# --- PAGE ROUTES ---
@app.route('/')
def index():
    if 'user_id' in session:
        return redirect(url_for('dashboard'))
    return render_template('login.html')

@app.route('/dashboard')
def dashboard():
    if 'user_id' not in session:
        return redirect(url_for('index'))
    return render_template('dashboard.html')

@app.route('/logout')
@app.route('/api/logout')
def logout():
    session.clear()
    return redirect(url_for('index'))

# --- AUTH / OTP ENDPOINTS ---
@app.route('/api/send-otp', methods=['POST'])
def send_otp():
    data = request.get_json() or {}
    phone = data.get('phone') or data.get('mobile')
    if not phone:
        return jsonify({'error': 'Phone number is required'}), 400

    otp_code = f"{random.randint(100000, 999999)}"
    
    session['pending_phone'] = str(phone)
    session['otp_code'] = str(otp_code)

    print("\n" + "="*50)
    print(f"[SMS GATEWAY MOCK] Verification Code for {phone}: {otp_code}")
    print("="*50 + "\n")

    return jsonify({'message': 'OTP sent successfully'})

@app.route('/api/verify-otp', methods=['POST'])
def verify_otp():
    data = request.get_json() or {}
    phone = str(data.get('phone') or data.get('mobile') or '')
    otp = str(data.get('otp') or data.get('code') or data.get('otp_code') or '')

    if not phone or not otp:
        return jsonify({'error': 'Phone and OTP code are required'}), 400

    stored_otp = str(session.get('otp_code', ''))
    pending_phone = str(session.get('pending_phone', ''))

    if stored_otp and stored_otp == otp and (pending_phone == phone or not pending_phone):
        user = User.query.filter_by(phone=phone).first()
        if not user:
            user = User(phone=phone)
            db.session.add(user)
            db.session.commit()

        session['user_id'] = user.id
        session['phone'] = user.phone
        return jsonify({'message': 'Logged in successfully'})

    return jsonify({'error': 'Invalid OTP code'}), 400

# --- CONTACTS ENDPOINTS ---
@app.route('/api/contacts', methods=['GET'])
def get_contacts():
    if 'user_id' not in session:
        return jsonify({'error': 'Unauthorized'}), 401
    
    user_id = session['user_id']
    contacts = Contact.query.filter_by(user_id=user_id).all()
    
    return jsonify([{
        'id': c.id,
        'name': c.name,
        'phone': c.phone,
        'email': getattr(c, 'email', '')
    } for c in contacts])

@app.route('/api/contacts', methods=['POST'])
def add_contact():
    if 'user_id' not in session:
        return jsonify({'error': 'Unauthorized'}), 401

    data = request.get_json() or {}
    name = data.get('name')
    phone = data.get('phone') or data.get('mobile')
    email = data.get('email', '')

    if not name or not phone:
        return jsonify({'error': 'Name and phone are required'}), 400

    user_id = session['user_id']
    new_contact = Contact(name=name, phone=phone, email=email, user_id=user_id)
    db.session.add(new_contact)
    db.session.commit()

    return jsonify({'message': 'Contact added successfully', 'id': new_contact.id}), 201

@app.route('/api/contacts/<int:contact_id>', methods=['DELETE'])
def delete_contact(contact_id):
    if 'user_id' not in session:
        return jsonify({'error': 'Unauthorized'}), 401

    user_id = session['user_id']
    contact = Contact.query.filter_by(id=contact_id, user_id=user_id).first()
    if not contact:
        return jsonify({'error': 'Contact not found'}), 404

    db.session.delete(contact)
    db.session.commit()
    return jsonify({'message': 'Contact deleted successfully'})

# --- CSV BULK IMPORT ENDPOINT ---
@app.route('/api/import-csv', methods=['POST'])
def import_csv():
    if 'user_id' not in session:
        return jsonify({'error': 'Unauthorized'}), 401

    if 'file' not in request.files:
        return jsonify({'error': 'No CSV file uploaded'}), 400

    file = request.files['file']
    if not file.filename.endswith('.csv'):
        return jsonify({'error': 'File must be a .csv'}), 400

    user_id = session['user_id']
    added_count = 0

    try:
        stream = io.StringIO(file.stream.read().decode("UTF-8"), newline=None)
        csv_reader = csv.DictReader(stream)

        for row in csv_reader:
            # Flexible column header checking
            name = row.get('name') or row.get('Name')
            phone = row.get('phone') or row.get('Phone') or row.get('mobile') or row.get('Mobile')
            email = row.get('email') or row.get('Email') or ''

            if name and phone:
                contact = Contact(name=name.strip(), phone=phone.strip(), email=email.strip(), user_id=user_id)
                db.session.add(contact)
                added_count += 1

        db.session.commit()
        return jsonify({'message': f'Successfully imported {added_count} contacts!'})
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': 'Error processing CSV file'}), 500

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)