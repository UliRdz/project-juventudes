// src/main.jsx
// PURPOSE: The JavaScript entry point. It takes the React component tree and
// renders it into the #root div defined in index.html.
// INTENDED OUTPUT LINK: this is the bridge between the HTML shell and React —
// nothing built in React (App and every future component) appears on screen
// until this file mounts it.

import React from "react";                 // The React library (needed for JSX and StrictMode).
import ReactDOM from "react-dom/client";   // The DOM renderer that attaches React to a real HTML element.
import App from "./App.jsx";               // The root component; the top of our component tree.
import "./styles/tokens.css";              // Load the brand design tokens globally so CSS variables exist everywhere.

// NOTE ON COMMENTS: inside JSX, comments must be written as {/* ... */} and only
// between an element's children — never directly after the ROOT element, where we
// are back in plain JS. So the lines below use {/* */} for the child and normal
// // comments for the surrounding JS. (This is exactly the mistake the build caught.)
const root = ReactDOM.createRoot(document.getElementById("root")); // Find <div id="root"> in index.html and create a React root there.
root.render(                                          // Render our component tree into that root.
  <React.StrictMode>                                  {/* StrictMode surfaces potential bugs in dev (no effect in production). */}
    <App />                                            {/* Render App — the whole UI grows from this single component. */}
  </React.StrictMode>                                  /* (closing the root element; StrictMode wraps the app) */
);                                                     // End render: the app is now live in the browser.
