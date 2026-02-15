# 🚀 Deploying to Vercel (No More Cold Starts)

This project has been optimized for **Vercel** to solve the "warm-up" delay experienced on Render's free tier. While Render takes 30–60 seconds to boot, Vercel Serverless Functions respond in ~1 second.

## 🛠 Project Changes for Vercel

1.  **`vercel.json`**: Added to the root to route all traffic to the Flask application via `wsgi.py`.
2.  **`requirements.txt`**: Optimized to remove heavy development dependencies (like Jupyter) to stay within Vercel's 250MB limit.
3.  **Serverless Architecture**: The app now runs as a function. It doesn't "stay on"—it executes instantly when a user visits.

## 🚀 How to Deploy

1.  **Fork/Push**: Ensure the `vercel.json` and the updated `requirements.txt` are in your repository.
2.  **Import to Vercel**:
    - Log in to [Vercel](https://vercel.com).
    - Click **"Add New"** > **"Project"**.
    - Import this GitHub repository.
3.  **Configure Environment Variables**:
    Before clicking "Deploy," open the **Environment Variables** section and add the keys from your `.env` file:
    - `SECRET_KEY`: (Your Flask secret key)
    - `NEONDB_USER`: (From Neon Console)
    - `NEONDB_PASSWORD`: (From Neon Console)
    - `NEONDB_HOST`: (From Neon Console)
    - `NEONDB_NAME`: (From Neon Console)
4.  **Deploy**: Click **Deploy**. Your app will be live at a `*.vercel.app` URL.

## 📝 Maintenance Notes

- **Database**: The connection to Neon PostgreSQL remains the same. Since Neon is also serverless, it pairs perfectly with Vercel.
- **Python Version**: Vercel defaults to Python 3.12. If you need to change this, update the `functions` runtime in `vercel.json`.
- **Logs**: If the app fails, check the **"Runtime Logs"** in the Vercel dashboard to see Flask or SQLAlchemy errors.

## ⚠️ Important Limit
Vercel has a **250MB limit** for the total size of your application + dependencies. Do not add large machine learning libraries or heavy data files to `requirements.txt` without checking their size first.
