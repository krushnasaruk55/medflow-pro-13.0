# 🏥 MedFlow Pro 6.0 - Advanced Hospital Management System (DTIL Documentation)

> **Transforming Healthcare Layouts with AI, Real-Time Connectivity, and Modern Design.**

MedFlow Pro is a state-of-the-art, cloud-native Hospital Management System (HMS) designed to streamline clinical workflows. This documentation provides a **Detailed Technical & Implementation Level (DTIL)** breakdown of the entire software ecosystem, covering its architecture, modules, workflows, and configuration.

---

## 📑 Table of Contents
1. [System Overview](#system-overview)
2. [Technology Stack](#technology-stack)
3. [Installation & Setup](#installation--setup)
4. [Project Structure](#project-structure)
5. [Core Modules (Detailed)](#core-modules-detailed)
    - [Reception & Triage](#1-reception--triage)
    - [Doctor's Workstation](#2-doctor-workstation)
    - [Pharmacy & Inventory](#3-pharmacy--inventory)
    - [Laboratory Management](#4-laboratory-management)
    - [IPD Management (In-Patient Department)](#5-ipd-management-in-patient-department)
    - [Patient Portal](#6-patient-portal-mobile--web)
    - [Super Admin](#7-super-admin)
6. [Key Workflows (DTIL Rules)](#key-workflows-dtil-rules)
7. [API Documentation](#api-documentation)
8. [Design System](#design-system)

---

## 🌟 System Overview
MedFlow Pro eliminates data silos between doctors, pharmacies, and laboratories. It follows a **"Unified Ecosystem"** implementation rule:
*   **Zero Latency**: All dashboards sync in real-time using WebSockets.
*   **Role-Based Access**: Strict separation of data between Reception, Doctor, Lab, Pharmacy, and Admin.
*   **Patient-Centric**: A single Patient ID links all records (OPD, IPD, Lab, Meds).

---

## 🛠 Technology Stack

| Layer | Technology | Description |
| :--- | :--- | :--- |
| **Backend** | **Node.js** & **Express** | Scaleable, event-driven RESTful API. |
| **Database** | **MongoDB** | NoSQL database for flexible medical record storage using Mongoose ODM. |
| **Real-Time** | **Socket.io** | Bi-directional event-based communication for queues and alerts. |
| **Frontend** | **Vanilla JS** (ES6+) | Optimized, lightweight frontend with zero framework overhead. |
| **Styling** | **Glassmorphism CSS** | Custom CSS variables, backdrop-filters, and modern layout engine. |
| **AI** | **Speech-to-Text** | Native Web Speech API for voice dictation. |
| **I18n** | **i18next** | Multi-language support (English, Hindi, Marathi). |

---

## � Installation & Setup

### Prerequisites
*   Node.js (v14+)
*   MongoDB (Running locally or Atlas)

### Step-by-Step Guide
1.  **Clone the Repository**
    ```bash
    git clone [repository-url]
    cd medflow-pro
    ```

2.  **Install Dependencies**
    ```bash
    npm install
    # Installs express, mongoose, socket.io, bcrypt, etc.
    ```

3.  **Environment Configuration**
    Create a `.env` file in the root:
    ```env
    PORT=3000
    MONGODB_URI=mongodb://localhost:27017/medflow
    SESSION_SECRET=your_secret_key_here
    ```

4.  **Run the Application**
    ```bash
    npm run dev
    # Starts server with Nodemon (auto-restart on changes)
    ```

5.  **Access Points**
    *   **Landing/Login**: `http://localhost:3000/index.html` or `http://localhost:3000/login.html`
    *   **Patient Portal**: `http://localhost:3000/patient-app.html`

---

## 📂 Project Structure

```text
medflow-pro/
├── public/                 # Static Assets (Frontend)
│   ├── css/                # Stylesheets (styles.css, doctor.css, ipd.css, etc.)
│   ├── js/                 # Client-side Logic (doctor.js, ipd.js, socket.io handlers)
│   ├── index.html          # Landing Page
│   ├── *.html              # Module Dashboards (doctor.html, pharmacy.html, etc.)
│   └── uploads/            # Stored assets (if any)
├── workflows/              # Workflow documentation
├── server.js               # Main Entry Point (API Routes, Socket config, DB connection)
├── package.json            # Dependencies & Scripts
├── README.md               # Documentation
└── .env                    # Secrets (Excluded from Git)
```

---

## 🚀 Core Modules (Detailed)

### 1. Reception & Triage
**Purpose**: Patient entry point and queue management.
*   **Token System**: Automatically assigns sequential tokens (e.g., #101, #102).
*   **Old Patient Search**: Instant lookup by Mobile Number or Name with auto-fill.
*   **Vitals Recording**: Pre-consultation entry of BP, Weight, SPO2 (sent to Doctor).
*   **Live Queue**: Visual dashboard of waiting patients.

### 2. Doctor Workstation
**Purpose**: Clinical diagnosis and prescription.
*   **Smart Queue**: Real-time list of waiting patients. Click to "Call Patient" (Visual notification).
*   **Speech-to-Text**: Built-in microphone support to dictate Diagnosis/Notes.
*   **One-Click Actions**:
    *   **Send to Pharmacy**: Instantly forwards prescription.
    *   **Send to Lab**: Opens Lab Request modal.
    *   **Admit (IPD)**: Transfers patient to Bed Management.
*   **History Timeline**: Scrollable view of all past visits and vitals.

### 3. Pharmacy & Inventory
**Purpose**: Retail and stock management.
*   **Live Orders**: Prescriptions appear instantly as "Pending Orders".
*   **One-Click Billing**: Convert prescription -> Bill. Auto-calculates total.
*   **Inventory Tracking**: Auto-deducts stock upon billing. Visual "Low Stock" alerts.
*   **Expiry Management**: Highlights medicines nearing expiry date.

### 4. Laboratory Management
**Purpose**: Pathology workflow.
*   **Incoming Requests**: See tests ordered by doctors.
*   **Result Entry**: Form-based entry for test parameters (e.g., Hemoglobin, BSL).
*   **Report Generation**: Auto-formats results into a printable report.
*   **Auto-delivery**: Once marked "Complete", report is visible to Doctor and Patient.

### 5. IPD Management (In-Patient Department)
**Purpose**: Hospital stay management.
*   **Bed Map**: Visual grid of Wards (Male/Female/ICU) and Beds (Occupied/Available).
*   **Admission Flow**: Assign patient to specific bed.
*   **Round Notes**: Doctors record daily progress notes for admitted patients.
*   **Transfer/Discharge**: Move patients between beds or finalize bill for checkout.
*   **IPD Billing**: Aggregates Room Charges + Lab + Pharmacy + Other Service charges.

### 6. Patient Portal (Mobile & Web)
**Purpose**: Patient engagement and self-service.
*   **Responsive Design**: Works on Mobile and Laptop (App-like interface).
*   **Live Queue Status**: "Your Token is #5, Current Serving #2". Stay home until called.
*   **Digital Records**: View own Prescriptions and Lab Reports.
*   **Pharmacy Ordering**: Upload prescription image or type order for home delivery.
*   **Appointment Booking**: Self-schedule visits.

### 7. Super Admin
**Purpose**: Multi-tenant management.
*   **Hospital Registration**: Onboard new clinics/hospitals.
*   **Analytics**: View system-wide usage stats.

---

## � Key Workflows (DTIL Rules)

### A. The "Out-Patient" (OPD) Rule
1.  **Arrival**: Patient -> Reception -> Register -> **Token Generated**.
2.  **Wait**: Patient monitors Live Queue on Mobile App.
3.  **Consult**: Doctor sees patient in queue -> Click "Call" -> **Dictates Prescription** -> Click "Send to Pharmacy".
4.  **Dispense**: Pharmacy sees "New Order" -> Generates Bill -> **Stock Deducted** -> Patient pays & leaves.

### B. The "In-Patient" (IPD) Rule
1.  **Decision**: Doctor clicks **"Admit"** from OPD Dashboard.
2.  **Allocation**: Nurse/Admin selects **Ward & Bed** in IPD Dashboard.
3.  **Care**: Daily "Round Notes" recorded by Doctor. Medicines added to IPD Bill.
4.  **Discharge**: Click "Discharge" -> System calculates **Total Stay Days** x **Room Rate** + **Meds** -> Final Invoice.
5.  **Release**: Bed marks as "Available" automatically along with Cleaning Status.

---

## 🔌 API Documentation
*Base URL: `/api`*

*   **POST** `/patients/register`: Create new patient.
*   **POST** `/patients/login`: Patient App Login.
*   **GET** `/patients/queue/:hospitalId`: Get live token list.
*   **POST** `/doctor/prescribe`: Save Diagnosis & Meds.
*   **POST** `/ipd/admit`: Allocate bed.
*   **GET** `/ipd/beds/:hospitalId`: Get visual bed map.
*   **POST** `/pharmacy/bill`: Generate invoice & update stock.

---

## 🎨 Design System
The UI follows a strict **Glassmorphism** rule:
*   **Cards**: `backdrop-filter: blur(12px); background: rgba(255,255,255,0.7);`
*   **Shadows**: Soft, multi-layered shadows for depth.
*   **Typography**: **'Outfit'** (Headings) & **'Inter'** (Body) from Google Fonts.
*   **Color Palette**:
    *   `--primary`: Indigo (#4f46e5)
    *   `--success`: Emerald (#10b981)
    *   `--bg-gradient`: Soft, moving mesh gradients.

---

*MedFlow Pro 6.0 Logic & Architecture Documentation.*
