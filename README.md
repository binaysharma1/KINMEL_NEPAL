# KinMel Nepal

Online shopping for Nepal — fashion for Men, Women and Kids with cart,
orders and digital payments (Khalti, eSewa, cash on delivery), plus an
admin dashboard for managing products and orders.

## Features

- Browse and search 1000+ products with category and price filters
- User registration, login (JWT) and persistent cart
- Checkout with cash on delivery, Khalti or eSewa
- Order history and status tracking
- Admin panel: add/update/remove products, view and manage orders

## Tech Stack

| Layer    | Technology                     |
|----------|--------------------------------|
| Frontend | React 19, Vite, Tailwind CSS   |
| Admin    | React 19, Vite, Tailwind CSS   |
| Backend  | Node.js, Express 5             |
| Database | MongoDB (Mongoose)             |
| Auth     | JWT (bcrypt password hashing)  |
| Payments | Khalti ePayment, eSewa         |

## Project Structure

```
E-commerce/
├── Backend/    # Express API (port 5000)
├── Frontend/   # Customer storefront (port 5173)
└── Admin/      # Admin dashboard (port 5174)
```

## Getting Started

Requirements: Node.js 18+, MongoDB (local or Atlas).

**1. Backend**

```bash
cd Backend
npm install
cp .env.example .env   # then fill in values (see below)
node server.js
```

**2. Storefront**

```bash
cd Frontend
npm install
npm run dev     # http://localhost:5173
```

**3. Admin panel**

```bash
cd Admin
npm install
npm run dev     # http://localhost:5174
```

## Environment Variables

Backend (`Backend/.env`):

| Variable                        | Purpose                                |
|---------------------------------|----------------------------------------|
| `PORT`                          | API port (default `5000`)              |
| `MONGoDB_URL`                   | MongoDB connection string (no db name) |
| `JWT_SECRET`                    | Secret for signing tokens              |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD`| Admin panel credentials                |
| `FRONTEND_URL` / `ADMIN_URL`    | Allowed CORS origins                   |
| `KHALTI_SECRET_KEY`             | Khalti payment key                     |
| `ESEWA_MERCHANT_CODE`           | eSewa merchant code                    |
| `DELIVERY_FEE` / `TAX_RATE`     | Order pricing rules                    |

Frontends (`Frontend/.env`, `Admin/.env`):

| Variable           | Purpose              |
|--------------------|----------------------|
| `VITE_BACKEND_URL` | Backend API base URL |

Seed demo products: `cd Backend && node seedProducts.js`

## Contributing

Branches per feature, pull requests into `main`. See open PRs for the
current convention.

## License

MIT (or your chosen license — add a `LICENSE` file to make this binding).
