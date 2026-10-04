# just99 - Render (free) par deploy

Is app mein koi code ya credential change nahi kiya gaya. Ye Express + MongoDB app hai, isliye Node host chahiye.

1. GitHub par ek **private** repo banao aur is folder ki files upload karo.
   (`.env` .gitignore ki wajah se upload NAHI hogi - ye theek hai.)
2. render.com -> New -> Web Service -> apna repo chuno.
3. Settings:
   - Runtime: Node
   - Build Command: `npm install && npm run build`
   - Start Command: `npm start`
   - Instance Type: Free
4. Environment Variables mein apni `.env` ki 4 values jaisi hain waisi hi daalo:
   MONGODB_URI, JWT_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD
5. MongoDB Atlas -> Network Access mein Render ko allow karna padega
   (Render ke IP badalte rehte hain, isliye aam taur par 0.0.0.0/0 allow karte hain).
6. Deploy ke baad `https://<naam>.onrender.com/health` kholo -> {"status":"ok"} aana chahiye.

Free plan note: 15 min idle rehne par site so jaati hai, pehli request 30-60 sec le sakti hai.
Custom domain chahiye to Cloudflare DNS mein CNAME Render ke address par laga sakte ho.
