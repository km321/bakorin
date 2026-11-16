import { ContactForm } from "./contact-form.tsx";

export const metadata = { title: "Contact" };

export default function ContactPage() {
  return (
    <section className="card">
      <h1>Contact us</h1>
      <p className="lede">Tell us a little about what you need. We read every message.</p>
      <ContactForm />
    </section>
  );
}
