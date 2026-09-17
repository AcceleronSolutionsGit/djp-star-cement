import { dbGet } from '../config/database.js';

/**
 * Handle user login.
 * Currently supports hardcoded mock users matching previous frontend logic,
 * but validates against the database if app_users table is populated.
 */
export async function login(req, res) {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    // Temporary mock fallback for legacy testing
    if (username === 'admin' && password === 'admin') {
      return res.json({
        user: { username: 'admin', role: 'admin' },
        token: 'mock-admin-token-123'
      });
    }
    
    if (username === 'so' && password === 'so') {
      return res.json({
        user: { username: 'so', role: 'SO' },
        token: 'mock-so-token-456'
      });
    }

    // Real DB check (if app_users exists and is populated)
    try {
      const user = await dbGet('SELECT * FROM app_users WHERE username = ?', [username]);
      if (!user) {
        return res.status(401).json({ error: 'Invalid username or password' });
      }

      // TODO: Use bcrypt for real password comparison
      if (user.password_hash !== password) {
         return res.status(401).json({ error: 'Invalid username or password' });
      }

      return res.json({
        user: {
          id: user.id,
          username: user.username,
          role: user.role,
          empCode: user.emp_code
        },
        token: `token-${user.id}-${Date.now()}`
      });
    } catch (dbErr) {
      // Table might not exist yet, fallback to hardcoded rejected
      return res.status(401).json({ error: 'Invalid username or password' });
    }
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}
