# Formbar.js

Formbar.js is a comprehensive classroom polling and management system built with Node.js. The system provides tools for *form*ative assessment and a visual representation of class status through an interactive *bar* interface. Originally written in Python for Raspberry Pi, Formbar.js is a complete rewrite in JavaScript designed to be platform-agnostic.

## Features

### Core Functionality
- **Real-time Polling**: Create and manage interactive polls with button, text, and multi-select response types; supports blind mode, vote changes, weighted responses, and excluded respondents
- **Classroom Management**: Create, start, end, and delete classes; enrollment via shareable join codes with regeneration support
- **Student Tracking**: Monitor student participation, poll responses, break status, and help requests in real time
- **Break & Help System**: Students request breaks with an optional reason; teachers approve or deny; separate help request queue with delete support
- **Timer System**: Server-side timers with start, pause, resume, end, and clear controls
- **Class Links**: Attach and manage resource links per classroom, accessible to enrolled students

### Role & Permission System
- **Scope-based Roles**: Fine-grained, scope-keyed permissions across global and class domains (poll, break, help, digipogs, roles, students, links, timer, and more)
- **Built-in Roles**: Manager, Teacher, Mod, Student, and Guest roles with sensible defaults
- **Custom Class Roles**: Teachers can create, rename, recolor, reorder, and delete class-specific roles with arbitrary scope sets
- **Multi-role Support**: Students can hold multiple concurrent roles within a class
- **Privilege Escalation Protection**: Users cannot grant scopes or roles that exceed their own permissions

### Digipog Economy
- **Digital Currency**: Award digipogs to students through poll participation or direct teacher awards
- **Transfer System**: Peer-to-peer digipog transfers secured by PIN verification with rate-limit lockout
- **Pool Management**: Create shared digipog pools, add or remove members, and execute payouts
- **Transaction Logging**: Complete paginated audit trail of all transfers and awards
- **Inventory System**: Item registry with configurable stack sizes; users accumulate items earned through app integrations

### Third-party & OAuth Integration
- **App Registration**: Register external applications to receive an API key, secret, and matching developer digipog pool
- **OAuth 2.0 Server**: Full authorization-code flow with token issuance and revocation for registered apps
- **OIDC Login**: Optional Google and Microsoft single sign-on via OpenID Connect
- **Email System**: Password reset and account verification emails (configurable)

### Advanced Features
- **Poll Sharing**: Share saved poll templates between users and classes via WebSocket
- **Notification System**: In-app notifications with pagination, mark-as-read, and delete support
- **IP Management**: Whitelist/blacklist system enforced at both HTTP and WebSocket layers
- **Inactivity Timeout**: Automatic WebSocket session logout after a configurable period of inactivity (API sockets exempt)
- **Guest Access**: Unauthenticated guest login for temporary class participation

### Technical Features
- **Versioned REST API**: `/api/v1` endpoints with a backward-compatible legacy `/api` shim and deprecation headers
- **WebSocket API**: Real-time bidirectional communication via Socket.io with scope-checked event middleware
- **Database**: SQLite with a structured migration system
- **Authentication**: Session-based, API key, JWT refresh tokens, and OIDC
- **Rate Limiting**: Per-IP request rate limiting and per-user digipog operation rate limiting
- **Logging**: Structured Winston-based logging with per-request event logging
- **Swagger/OpenAPI Docs**: Auto-generated API documentation served at `/docs`
- **Testing**: Jest test suite covering controllers, services, middleware, and socket handlers

## Quick Start

### Prerequisites
- Node.js 18 or later (required by dependencies such as `bcrypt`)
- npm (included with Node) or compatible client (for example Yarn)

### Installation
```bash
git clone https://github.com/csmith1188/Formbar.js.git
cd Formbar.js
npm install
```

### Database Setup
```bash
npm run init-db
npm run migrate
```

### Running the Application
```bash
# Development
npm run dev

# Production
npm start
```

### Configuration
1. Copy `.env-template` to `.env`
2. Configure your settings (port, email, OAuth, etc.)
3. The application will generate JWT keys automatically on first run

## API Documentation

### HTTP API

- **Local:** http://localhost:420/docs
- **Live:** https://formbarapi.yorktechapps.com/docs

### WebSocket API

- **Documentation:** https://github.com/csmith1188/Formbar.js/wiki/WebSocket-API

## Development

### Scripts
- `npm run dev` - Start with nodemon for development
- `npm start` - Start production server
- `npm test` - Run test suite
- `npm run format` - Format code with Prettier
- `npm run init-db` - Initialize database
- `npm run migrate` - Run database migrations

### Project Structure
```
├── app.js                 # Main application entry point
├── modules/               # Core application modules
├── routes/                # HTTP route handlers
├── sockets/               # WebSocket event handlers
├── views/                 # EJS templates
├── static/                # Static assets (CSS, JS, images)
├── database/              # Database initialization and migrations
└── tests/                 # Test files
```

## License

This project is licensed under the YCSTEL-1.0 License.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## Support

For issues and questions:
- GitHub Issues: https://github.com/csmith1188/Formbar.js/issues
