// Nate Heim
// 07/05/2025

const { onRequest } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const axios = require('axios');

// Initialize Firebase Admin
const functionsConfig = require('firebase-functions').config();
const base64 = functionsConfig.app?.firebase_service_account_base64;

if (!admin.apps.length) {
    if (base64) {
        const serviceAccount = JSON.parse(
            Buffer.from(base64, 'base64').toString('utf8')
        );
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
        });
    } else {
        admin.initializeApp();
    }
}

const db = admin.firestore();
const wishlistRef = db.collection('wishlist');

const CHEAPSHARK_URL = 'https://www.cheapshark.com/api/1.0/deals';

// Search function (HTML snippets)
exports.search = onRequest(async (req, res) => {
    try {
        const game = req.query.game;
        const response = await axios.get(CHEAPSHARK_URL, {
            params: { title: game },
        });
        const games = response.data;

        let html = '';
        for (const game of games) {
            html += `
                <div class="game-card">
                    <h3>${game.title}</h3>
                    <p>Sale Price: $${game.salePrice}</p>
                    <p>Normal Price: $${game.normalPrice}</p>
                    <button 
                        hx-post="/api/wishlist" 
                        hx-vals='${JSON.stringify({
                            title: game.title,
                            salePrice: game.salePrice,
                            normalPrice: game.normalPrice
                        })}'
                        hx-trigger="click"
                        hx-target="#wishlist"
                        hx-swap="outerHTML"
                    >
                        Add to Wishlist
                    </button>
                </div>
            `;
        }

        res.send(html || '<p>No results found.</p>');
    } catch (err) {
        console.error(err);
        res.status(500).send('<p>Error fetching from CheapShark</p>');
    }
});

// Add to wishlist (JSON but triggers HTMX refresh)
exports.addToWishlist = onRequest(async (req, res) => {
    try {
        const data = req.body;
        const existing = await wishlistRef.where('title', '==', data.title).get();

        if (!existing.empty) {
            res.set('HX-Trigger', 'refreshWishlist');
            return res.json({ message: 'Already in wishlist' });
        }

        await wishlistRef.add(data);
        res.set('HX-Trigger', 'refreshWishlist');
        res.json({ message: 'Added to wishlist' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to add to wishlist' });
    }
});

// Get wishlist (HTML snippets)
exports.getWishlist = onRequest(async (req, res) => {
    try {
        const snapshot = await wishlistRef.get();
        let html = '';

        for (const doc of snapshot.docs) {
            const item = { id: doc.id, ...doc.data() };
            html += `
                <div class="wishlist-item">
                    <h4>${item.title}</h4>
                    <p>Sale Price: $${item.salePrice}</p>
                    <p>Normal Price: $${item.normalPrice}</p>
                    <button 
                        hx-delete="/api/wishlist/${item.id}" 
                        hx-trigger="click"
                        hx-target="#wishlist"
                        hx-swap="outerHTML"
                    >
                        Remove
                    </button>
                </div>
            `;
        }

        res.send(html || '<p>Your wishlist is empty.</p>');
    } catch (err) {
        console.error(err);
        res.status(500).send('<p>Failed to fetch wishlist.</p>');
    }
});

// Delete wishlist item (JSON but triggers HTMX refresh)
exports.deleteWishlistItem = onRequest(async (req, res) => {
    try {
        const id = req.path.split('/').pop();
        await wishlistRef.doc(id).delete();
        res.set('HX-Trigger', 'refreshWishlist');
        res.json({ message: 'Deleted from wishlist' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to delete' });
    }
});
