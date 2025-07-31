const axios = require('axios');
const { execSync } = require('child_process');

// API Configuration
const API_CONFIG = {
  BASE_URL: 'http://37.233.85.212:51821',
  PASSWORD: process.env.WG_API_PASSWORD, // Make sure this environment variable is set
  TIMEOUT: 15000
};

// Global session cookie
let sessionCookie = null;

const api = axios.create({
  baseURL: API_CONFIG.BASE_URL,
  timeout: API_CONFIG.TIMEOUT,
  headers: {
    'Accept': 'application/json',
    'Content-Type': 'application/json'
  }
});

// Interceptor to handle cookies
api.interceptors.request.use(config => {
  if (sessionCookie) {
    config.headers.Cookie = sessionCookie;
  }
  return config;
});

/**
 * Performs login to the WireGuard API.
 * @returns {Promise<boolean>} True if login is successful, false otherwise.
 */
async function login() {
  try {
    const response = await api.post('/api/session', {
      password: API_CONFIG.PASSWORD
    });

    sessionCookie = response.headers['set-cookie']?.toString();
    if (!sessionCookie) {
      throw new Error('Authorization cookies not received');
    }

    console.log('🔑 Authorization successful');
    return true;
  } catch (error) {
    console.error('❌ Authorization error:', {
      status: error.response?.status,
      data: error.response?.data
    });
    throw new Error('Login error');
  }
}

/**
 * Creates a new WireGuard client.
 * @param {string} clientName - The name of the client to create.
 * @returns {Promise<object>} The data of the created client, including privateKey, address, and serverPublicKey.
 */
async function createClient(clientName) {
  try {
    const response = await api.post('/api/wireguard/client', {
      name: clientName,
      allowedIPs: '10.8.0.0/24' // Adjust AllowedIPs as needed
    });
    // It is crucial that the API response for client creation includes privateKey, address, and serverPublicKey.
    // If not, this function or the API design needs adjustment.
    return response.data;
  } catch (error) {
    console.error('❌ Client creation error:', {
      status: error.response?.status,
      data: error.response?.data
    });
    throw error;
  }
}

/**
 * Retrieves data for a specific WireGuard client.
 * This function is now primarily for retrieving general client info, not sensitive keys.
 * @param {string} clientName - The name of the client to retrieve data for.
 * @returns {Promise<object>} The client data.
 */
async function getClientData(clientName) {
  try {
    const response = await api.get('/api/wireguard/client');
    const client = response.data.find(c => c.name === clientName);

    if (!client) {
      throw new Error('Client not found');
    }
    return client;
  } catch (error) {
    console.error('❌ Error getting client data:', error.message);
    throw error;
  }
}

/**
 * Generates the WireGuard configuration string.
 * @param {object} clientData - The client data containing privateKey, address, and serverPublicKey.
 * @returns {string} The WireGuard configuration string.
 */
function generateConfig(clientData) {
  // Ensure clientData and its properties exist before accessing them
  if (!clientData || !clientData.privateKey || !clientData.address || !clientData.serverPublicKey) {
    console.error('Insufficient data for configuration generation:', clientData);
    throw new Error('Missing required data for configuration generation (privateKey, address, or serverPublicKey).');
  }

  // The endpoint needs to be just the IP/hostname without http:// and port
  const endpoint = API_CONFIG.BASE_URL.replace('http://', '').replace(':51821', '') + ':51820';

  return `[Interface]
PrivateKey = ${clientData.privateKey}
Address = ${clientData.address}
DNS = 1.1.1.1

[Peer]
PublicKey = ${clientData.serverPublicKey}
Endpoint = ${endpoint}
AllowedIPs = 0.0.0.0/0
PersistentKeepalive = 25`;
}

/**
 * Main function to create a VPN client and generate its configuration.
 * @param {string} clientName - The name of the client to create.
 * @returns {Promise<string>} The generated WireGuard configuration.
 */
exports.createVpnClient = async (clientName) => {
  try {
    // 1. Authorization
    await login();

    // 2. Create client and capture its full data (including privateKey)
    console.log(`⌛ Creating client: ${clientName}`);
    const createdClientData = await createClient(clientName); // Capture the response data here

    // 3. Verify that essential data is available from the creation step
    if (!createdClientData || !createdClientData.privateKey || !createdClientData.address || !createdClientData.serverPublicKey) {
        console.error('❌ Data from client creation is incomplete:', createdClientData);
        throw new Error('Client creation response did not contain all necessary keys (privateKey, address, or serverPublicKey).');
    }

    // 4. Generate configuration using the data obtained directly from creation
    console.log(`⚙️ Generating config for: ${clientName}`);
    const config = generateConfig(createdClientData); // Use data from createClient

    if (!config) {
      throw new Error('Failed to generate configuration');
    }

    console.log('✅ Configuration successfully generated');
    return config;
  } catch (error) {
    console.error('🔥 Critical error:', {
      message: error.message,
      stack: error.stack
    });
    throw new Error(`Failed to create VPN client: ${error.message}`);
  }
};
