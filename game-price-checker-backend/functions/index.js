// Nate Heim
// 07/05/2025

const { onRequest } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const express = require('express');
const cors = require('cors');
const axios = require('axios');

// Initialize Firebase Admin
const base64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;

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

const app = express();
app.use(cors({ origin: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const API_BASE_URL = 'https://app-pibd3c5hcq-uc.a.run.app';

// Middleware to verify Firebase token
async function verifyFirebaseToken(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized: No token provided' });
    }

    const idToken = authHeader.split('Bearer ')[1];

    try {
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        req.user = decodedToken;
        next();
    } catch (err) {
        console.error('Token verification failed:', err);
        res.status(401).json({ error: 'Unauthorized: Invalid token' });
    }
}

// SEARCH (no auth needed)
app.get('/search', async (req, res) => {
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
                    <img src="${game.thumb}" alt="${game.title} cover" style="width:150px;height:auto;float:left;margin-right:15px;">
                    <div style="display: flex; flex-direction: column;">
                        <h3>${game.title}</h3>
                        <div>
                            <strong style="font-size: 1.2em;">$${game.salePrice}</strong><br>
                            <span style="text-decoration: line-through; color: gray;">$${game.normalPrice}</span>
                        </div>
                        <div style="margin-top: 10px; display: flex; gap: 10px;">
                            <form 
                                hx-post="${API_BASE_URL}/addToWishlist" 
                                hx-target="#wishlist"
                                hx-swap="outerHTML"
                                style="display: inline;"
                            >
                                <input type="hidden" name="title" value="${game.title}">
                                <input type="hidden" name="salePrice" value="${game.salePrice}">
                                <input type="hidden" name="normalPrice" value="${game.normalPrice}">
                                <input type="hidden" name="dealID" value="${game.dealID}">
                                <button type="submit">Add to Wishlist</button>
                            </form>
                            <a href="https://www.cheapshark.com/redirect?dealID=${game.dealID}" target="_blank">
                                <button type="button">View Deal</button>
                            </a>
                        </div>
                    </div>
                </div>
                <hr style="clear: both;">
            `;
        }

        res.send(html || '<p>No results found.</p>');
    } catch (err) {
        console.error(err);
        res.status(500).send('<p>Error fetching from CheapShark</p>');
    }
});

// ADD TO WISHLIST (protected)
app.post('/addToWishlist', verifyFirebaseToken, async (req, res) => {
    try {
        const userId = req.user.uid;
        const data = {
            title: req.body.title,
            salePrice: req.body.salePrice,
            normalPrice: req.body.normalPrice,
            dealID: req.body.dealID,
            userId: userId // Associate item with the user
        };

        console.log('Adding to wishlist:', data);

        // Check if already exists for this user
        const existing = await wishlistRef
            .where('title', '==', data.title)
            .where('userId', '==', userId)
            .get();

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

// GET WISHLIST (protected)
app.get('/getWishlist', verifyFirebaseToken, async (req, res) => {
    try {
        const userId = req.user.uid;
        const snapshot = await wishlistRef.where('userId', '==', userId).get();
        let html = '';

        for (const doc of snapshot.docs) {
            const item = { id: doc.id, ...doc.data() };
            html += `
                <div class="wishlist-item" style="display: flex; justify-content: space-between; align-items: flex-start; padding: 10px; border: 1px solid #ccc; border-radius: 5px; margin-bottom: 10px;">
                    <div>
                        <h4 style="margin: 0 0 5px 0;">${item.title}</h4>
                        <strong style="font-size: 1.1em;">$${item.salePrice}</strong><br>
                        <span style="text-decoration: line-through; color: gray; font-size: 0.9em;">$${item.normalPrice}</span>
                    </div>
                    <div style="display: flex; flex-direction: column; gap: 5px; min-width: 80px;">
                        <button 
                            style="padding: 5px; font-size: 0.85em;"
                            hx-delete="${API_BASE_URL}/deleteWishlistItem/${item.id}" 
                            hx-trigger="click"
                            hx-target="#wishlist"
                            hx-swap="outerHTML"
                        >
                            Remove
                        </button>
                        ${
                            item.dealID
                                ? `<a href="https://www.cheapshark.com/redirect?dealID=${item.dealID}" target="_blank">
                                        <button type="button" style="padding: 5px; font-size: 0.85em;">View Deal</button>
                                   </a>`
                                : ''
                        }
                    </div>
                </div>
            `;
        }

        res.send(html || '<p>Your wishlist is empty.</p>');
    } catch (err) {
        console.error(err);
        res.status(500).send('<p>Failed to fetch wishlist.</p>');
    }
});

// DELETE WISHLIST ITEM (protected)
app.delete('/deleteWishlistItem/:id', verifyFirebaseToken, async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.uid;

        const doc = await wishlistRef.doc(id).get();
        if (!doc.exists || doc.data().userId !== userId) {
            return res.status(403).json({ error: 'Unauthorized: Cannot delete this item' });
        }

        await wishlistRef.doc(id).delete();
        res.set('HX-Trigger', 'refreshWishlist');
        res.json({ message: 'Deleted from wishlist' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to delete' });
    }
});

// Export as a single Cloud Function
exports.app = onRequest(app);
