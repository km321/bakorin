"use client";

import { RecordForm } from "@bakorin/sdk/react";

const THANKS = "Thanks for your message. We will get back to you soon.";

// Anyone can send the form (leads: create: public in app.yaml), five times per ten
// minutes per visitor. Only admins can read what was sent.
export function ContactForm() {
  return (
    <RecordForm
      entity="leads"
      include={["name", "email", "company", "message"]}
      multiline={["message"]}
      labels={{ name: "Your name", email: "Email", company: "Company (optional)" }}
      submitLabel="Send message"
      successMessage={THANKS}
    />
  );
}
