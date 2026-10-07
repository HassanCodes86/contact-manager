// Helper to display alerts
function showAlert(message, isError = true) {
    const alertBox = document.getElementById('alertBox') || document.getElementById('alert-box');
    if (alertBox) {
        alertBox.textContent = message;
        alertBox.className = isError ? 'alert alert-error' : 'alert alert-success';
        alertBox.classList.remove('hidden');
        alertBox.style.display = 'block';
    } else {
        alert(message);
    }
}

function hideAlert() {
    const alertBox = document.getElementById('alertBox') || document.getElementById('alert-box');
    if (alertBox) {
        alertBox.style.display = 'none';
        alertBox.classList.add('hidden');
    }
}

// 1. Request OTP Function
async function handleSendOTP(event) {
    event.preventDefault();
    hideAlert();

    const phoneInput = document.getElementById('phoneInput');
    const phone = phoneInput ? phoneInput.value.trim() : '';

    if (!phone || phone.length < 10) {
        showAlert('Please enter a valid 10-digit phone number.');
        return;
    }

    // Store phone number in browser storage
    sessionStorage.setItem('loginPhone', phone);

    const sendBtn = document.getElementById('sendOtpBtn');
    if (sendBtn) sendBtn.disabled = true;

    try {
        const response = await fetch('/api/send-otp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone: phone, mobile: phone })
        });

        const data = await response.json();

        if (response.ok) {
            showAlert('OTP sent successfully! Check your terminal.', false);

            const phoneForm = document.getElementById('phoneForm');
            const otpForm = document.getElementById('otpForm');
            if (phoneForm) phoneForm.classList.add('hidden');
            if (otpForm) otpForm.classList.remove('hidden');
        } else {
            showAlert(data.error || 'Failed to send OTP.');
        }
    } catch (error) {
        showAlert('Network error. Please check if your server is running.');
    } finally {
        if (sendBtn) sendBtn.disabled = false;
    }
}

// 2. Verify OTP Function
async function handleVerifyOTP(event) {
    event.preventDefault();
    hideAlert();

    const phoneInput = document.getElementById('phoneInput');
    const otpInput = document.getElementById('otpInput');

    // Retrieve saved phone number from storage
    const phone = sessionStorage.getItem('loginPhone') || (phoneInput ? phoneInput.value.trim() : '');
    const otp = otpInput ? otpInput.value.trim() : '';

    if (!phone || !otp) {
        showAlert('Phone number and OTP code are required.');
        return;
    }

    const verifyBtn = document.getElementById('verifyOtpBtn');
    if (verifyBtn) verifyBtn.disabled = true;

    try {
        const response = await fetch('/api/verify-otp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                phone: phone,
                mobile: phone,
                otp: otp,
                code: otp,
                otp_code: otp
            })
        });

        const data = await response.json();

        if (response.ok) {
            showAlert('Login Successful! Redirecting...', false);
            sessionStorage.removeItem('loginPhone');
            setTimeout(() => {
                window.location.href = '/dashboard';
            }, 1000);
        } else {
            showAlert(data.error || 'Invalid OTP code.');
        }
    } catch (error) {
        showAlert('Verification failed. Server error.');
    } finally {
        if (verifyBtn) verifyBtn.disabled = false;
    }
}

// 3. Reset / Change Phone Number
function resetAuthForm() {
    hideAlert();
    sessionStorage.removeItem('loginPhone');
    const phoneForm = document.getElementById('phoneForm');
    const otpForm = document.getElementById('otpForm');
    const otpInput = document.getElementById('otpInput');

    if (otpInput) otpInput.value = '';
    if (otpForm) otpForm.classList.add('hidden');
    if (phoneForm) phoneForm.classList.remove('hidden');
}