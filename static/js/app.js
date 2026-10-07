// Smart API request helper
async function apiRequest(endpoint, options = {}) {
    let response = await fetch('/api' + endpoint, options);
    if (response.status === 404) {
        response = await fetch(endpoint, options);
    }
    return response;
}

function showDashboardAlert(message, isError = false) {
    const alertBox = document.getElementById('dashboard-alert') ||
        document.getElementById('alertBox') ||
        document.getElementById('alert-box');
    if (alertBox) {
        alertBox.textContent = message;
        alertBox.className = isError ? 'alert alert-error' : 'alert alert-success';
        alertBox.style.display = 'block';
        setTimeout(() => { alertBox.style.display = 'none'; }, 4000);
    }
}

function getTableBody() {
    return document.getElementById('contacts-body') ||
        document.getElementById('contactsBody') ||
        document.getElementById('contactList') ||
        document.querySelector('tbody');
}

// 1. Render all 5 columns: ID, Name, Phone, Category, Actions
async function loadContacts() {
    const tbody = getTableBody();
    if (!tbody) return;

    try {
        const response = await apiRequest('/contacts');
        if (!response.ok) return;

        const contacts = await response.json();
        tbody.innerHTML = '';

        if (!contacts || contacts.length === 0) {
            tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:1rem;">No contacts found.</td></tr>`;
            return;
        }

        contacts.forEach(contact => {
            const row = document.createElement('tr');
            row.innerHTML = `
        <td>${contact.id || '-'}</td>
        <td>${contact.name || ''}</td>
        <td>${contact.phone || contact.mobile || ''}</td>
        <td>${contact.category || contact.email || '-'}</td>
        <td>
          <button class="btn btn-danger" style="padding:0.3rem 0.6rem; font-size:0.8rem; border-radius:4px; cursor:pointer;" onclick="deleteContact(${contact.id})">Delete</button>
        </td>
      `;
            tbody.appendChild(row);
        });
    } catch (err) {
        console.error('Error loading contacts:', err);
    }
}

// 2. Add Contact Handler
async function handleAddContact(event) {
    if (event) event.preventDefault();

    const nameInput = document.getElementById('name') || document.getElementById('contactName') || document.getElementById('nameInput');
    const phoneInput = document.getElementById('phone') || document.getElementById('contactPhone') || document.getElementById('phoneInput');
    const categoryInput = document.getElementById('category') || document.getElementById('email') || document.getElementById('contactEmail');

    const name = nameInput ? nameInput.value.trim() : '';
    const phone = phoneInput ? phoneInput.value.trim() : '';
    const category = categoryInput ? categoryInput.value.trim() : '';

    if (!name || !phone) {
        showDashboardAlert('Name and phone number are required.', true);
        return;
    }

    try {
        const response = await apiRequest('/contacts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, phone, mobile: phone, email: category, category: category })
        });

        if (response.ok) {
            showDashboardAlert('Contact saved successfully!');
            if (nameInput) nameInput.value = '';
            if (phoneInput) phoneInput.value = '';
            if (categoryInput) categoryInput.value = '';
            loadContacts();
        } else {
            const data = await response.json();
            showDashboardAlert(data.error || 'Failed to add contact', true);
        }
    } catch (err) {
        showDashboardAlert('Error connecting to server', true);
    }
}

// 3. Delete Contact
async function deleteContact(id) {
    if (!confirm('Are you sure you want to delete this contact?')) return;

    try {
        const response = await apiRequest(`/contacts/${id}`, { method: 'DELETE' });
        if (response.ok) {
            showDashboardAlert('Contact deleted.');
            loadContacts();
        } else {
            showDashboardAlert('Failed to delete contact.', true);
        }
    } catch (err) {
        showDashboardAlert('Error deleting contact.', true);
    }
}

// 4. Initialize
document.addEventListener('DOMContentLoaded', () => {
    const contactForm = document.getElementById('contact-form') ||
        document.getElementById('addContactForm') ||
        document.querySelector('form');

    if (contactForm) {
        contactForm.addEventListener('submit', handleAddContact);
    }

    loadContacts();
});