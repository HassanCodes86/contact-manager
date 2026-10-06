from flask import Flask, jsonify, render_template, request

app = Flask(__name__)

# Dataset with 20 contacts
contacts = [
    {"id": 1, "name": "Aarav Sharma", "phone": "9820012345"},
    {"id": 2, "name": "Aditi Rao", "phone": "9821123456"},
    {"id": 3, "name": "Ananya Pandey", "phone": "9833345678"},
    {"id": 4, "name": "Dev Patel", "phone": "9876543210"},
    {"id": 5, "name": "Ishan Kishan", "phone": "9123456789"},
    {"id": 6, "name": "Kabir Mehta", "phone": "9988776655"},
    {"id": 7, "name": "Meera Joshi", "phone": "9898989898"},
    {"id": 8, "name": "Neha Gupta", "phone": "9765432109"},
    {"id": 9, "name": "Priya Verma", "phone": "9654321098"},
    {"id": 10, "name": "Rahul Dravid", "phone": "9543210987"},
    {"id": 11, "name": "Rohan Kapoor", "phone": "9432109876"},
    {"id": 12, "name": "Siddharth Malhotra", "phone": "9321098765"},
    {"id": 13, "name": "Sneha Kulkarni", "phone": "9210987654"},
    {"id": 14, "name": "Tanvi Shah", "phone": "9109876543"},
    {"id": 15, "name": "Vikram Rathore", "phone": "9098765432"},
    {"id": 16, "name": "Yash Dasgupta", "phone": "9887766554"},
    {"id": 17, "name": "Zara Khan", "phone": "9776655443"},
    {"id": 18, "name": "Amitabh Sen", "phone": "9665544332"},
    {"id": 19, "name": "Bhavna Menon", "phone": "9554433221"},
    {"id": 20, "name": "Chirag Shetty", "phone": "9443322110"},
]


# Serve the UI Homepage
@app.route('/')
def home():
  return render_template('index.html')


# PCM-4: Health Check Endpoint
@app.route('/health', methods=['GET'])
def health_check():
  return jsonify({'status': 'OK'}), 200


# PCM-2: Get All Contacts
@app.route('/items', methods=['GET'])
def get_contacts():
  return jsonify(contacts), 200


# Search contacts by Name or ID
@app.route('/items/search', methods=['GET'])
def search_contacts():
  query = request.args.get('query', '').strip().lower()
  if not query:
    return jsonify(contacts), 200

  results = [
      c
      for c in contacts
      if query in c['name'].lower() or query == str(c['id'])
  ]
  return jsonify(results), 200


# PCM-3: Add New Contact with Validation
@app.route('/items', methods=['POST'])
def add_contact():
  data = request.get_json()
  if not data or 'name' not in data or 'phone' not in data:
    return jsonify({'error': 'Name and phone are required'}), 400

  name = str(data['name']).strip()
  phone = str(data['phone']).strip()

  if not name:
    return jsonify({'error': 'Name cannot be empty'}), 400

  # 1. Reject non-numeric input in phone field
  if not phone.isdigit():
    return (
        jsonify({
            'error': (
                'Text/letters are not supported in phone numbers. Please enter'
                ' numbers only.'
            )
        }),
        400,
    )

  # 2. Reject phone numbers that are not exactly 10 digits
  if len(phone) != 10:
    return (
        jsonify({
            'error': (
                'Phone number must be exactly 10 digits. Please check it out.'
            )
        }),
        400,
    )

  new_contact = {'id': len(contacts) + 1, 'name': name, 'phone': phone}
  contacts.append(new_contact)
  return jsonify(new_contact), 201


if __name__ == '__main__':
  app.run(host='0.0.0.0', port=5000, debug=True)