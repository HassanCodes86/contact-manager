from flask import Flask, jsonify, request

app = Flask(__name__)

# In-memory storage for Contact Manager
contacts = [
    {"id": 1, "name": "Alice Smith", "phone": "9876543210"},
    {"id": 2, "name": "Bob Jones", "phone": "9123456789"},
]


# PCM-4: Health Check Endpoint
@app.route("/health", methods=["GET"])
def health_check():
  return jsonify({"status": "OK"}), 200


# PCM-2: View Contacts Endpoint
@app.route("/items", methods=["GET"])
def get_contacts():
  return jsonify(contacts), 200


# PCM-3: Add Contact Endpoint
@app.route("/items", methods=["POST"])
def add_contact():
  data = request.get_json()
  if not data or "name" not in data or "phone" not in data:
    return jsonify({"error": "Name and phone are required"}), 400

  new_contact = {
      "id": len(contacts) + 1,
      "name": data["name"],
      "phone": data["phone"],
  }
  contacts.append(new_contact)
  return jsonify(new_contact), 201


if __name__ == "__main__":
  app.run(host="0.0.0.0", port=5000)