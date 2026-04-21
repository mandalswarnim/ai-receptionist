"use client";

import { motion, useInView } from "framer-motion";
import { useRef, useState, useEffect } from "react";

const transcript = [
  {
    role: "ai" as const,
    text: "Good afternoon! Thank you for calling Sunrise Dental. How can I help you today?",
  },
  {
    role: "caller" as const,
    text: "Hi, I'd like to book a cleaning appointment for next week.",
  },
  {
    role: "ai" as const,
    text: "Of course! I'd be happy to help you schedule that. Could I get your name please?",
  },
  { role: "caller" as const, text: "Sure, it's Sarah Johnson." },
  {
    role: "ai" as const,
    text: "Thank you, Sarah. And what's the best phone number to reach you?",
  },
  { role: "caller" as const, text: "555-0142." },
  {
    role: "ai" as const,
    text: "Perfect. Do you have a preferred day and time next week?",
  },
  {
    role: "caller" as const,
    text: "Tuesday afternoon would be ideal, around 2pm.",
  },
  {
    role: "ai" as const,
    text: "Great choice! I've captured all your details and sent a booking request to Dr. Martinez's office. You'll receive a confirmation call shortly. Is there anything else I can help with?",
  },
  { role: "caller" as const, text: "No, that's perfect. Thank you!" },
  {
    role: "ai" as const,
    text: "You're welcome, Sarah! Have a wonderful day. Goodbye!",
  },
];

export default function Demo() {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-100px" });
  const [visibleMessages, setVisibleMessages] = useState(0);

  useEffect(() => {
    if (!isInView) return;
    const timer = setInterval(() => {
      setVisibleMessages((prev) => {
        if (prev >= transcript.length) {
          clearInterval(timer);
          return prev;
        }
        return prev + 1;
      });
    }, 800);
    return () => clearInterval(timer);
  }, [isInView]);

  return (
    <section id="demo" className="py-24 md:py-32 bg-white" ref={ref}>
      <div className="max-w-7xl mx-auto px-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
          className="text-center mb-16"
        >
          <p className="text-sm font-medium text-indigo-500 uppercase tracking-wider mb-3">
            Live Preview
          </p>
          <h2 className="text-3xl md:text-5xl font-bold tracking-tight mb-4">
            See it in action
          </h2>
          <p className="text-gray-600 text-lg max-w-2xl mx-auto">
            Here&apos;s what a real call sounds like. Natural, helpful, and
            professional — every single time.
          </p>
        </motion.div>

        <div className="max-w-3xl mx-auto grid grid-cols-1 lg:grid-cols-5 gap-8">
          {/* Call transcript */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={isInView ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="lg:col-span-3 rounded-2xl border border-gray-200 bg-white shadow-xl shadow-gray-100/50 overflow-hidden"
          >
            <div className="flex items-center gap-3 px-5 py-3 border-b border-gray-100 bg-gray-50/50">
              <div className="w-3 h-3 rounded-full bg-green-400 animate-pulse" />
              <span className="text-sm font-medium text-gray-600">
                Live Call — Sunrise Dental
              </span>
              <span className="ml-auto text-xs text-gray-400 font-mono">
                00:47
              </span>
            </div>
            <div className="p-5 space-y-4 h-[420px] overflow-y-auto">
              {transcript.slice(0, visibleMessages).map((msg, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3 }}
                  className={`flex ${
                    msg.role === "caller" ? "justify-end" : "justify-start"
                  }`}
                >
                  <div
                    className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                      msg.role === "caller"
                        ? "bg-indigo-500 text-white rounded-br-md"
                        : "bg-gray-100 text-gray-800 rounded-bl-md"
                    }`}
                  >
                    {msg.text}
                  </div>
                </motion.div>
              ))}
              {visibleMessages < transcript.length && isInView && (
                <div className="flex justify-start">
                  <div className="bg-gray-100 rounded-2xl rounded-bl-md px-4 py-3">
                    <div className="flex gap-1">
                      <div className="w-2 h-2 rounded-full bg-gray-400 animate-bounce" />
                      <div
                        className="w-2 h-2 rounded-full bg-gray-400 animate-bounce"
                        style={{ animationDelay: "0.15s" }}
                      />
                      <div
                        className="w-2 h-2 rounded-full bg-gray-400 animate-bounce"
                        style={{ animationDelay: "0.3s" }}
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          </motion.div>

          {/* Booking email preview */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={isInView ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.6, delay: 0.4 }}
            className="lg:col-span-2 rounded-2xl border border-gray-200 bg-white shadow-xl shadow-gray-100/50 overflow-hidden h-fit"
          >
            <div className="px-5 py-3 border-b border-gray-100 bg-gray-50/50">
              <span className="text-sm font-medium text-gray-600">
                Email Sent
              </span>
            </div>
            <div className="p-5">
              <div className="mb-4">
                <p className="text-xs text-gray-400 mb-1">To</p>
                <p className="text-sm text-gray-700">
                  dr.martinez@sunrisedental.com
                </p>
              </div>
              <div className="mb-4">
                <p className="text-xs text-gray-400 mb-1">Subject</p>
                <p className="text-sm font-medium text-gray-900">
                  New Booking Request — Sarah Johnson
                </p>
              </div>
              <div className="rounded-xl bg-gray-50 border border-gray-100 p-4 text-sm space-y-2.5">
                <div className="flex justify-between">
                  <span className="text-gray-500">Name</span>
                  <span className="font-medium">Sarah Johnson</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Phone</span>
                  <span className="font-medium">555-0142</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Service</span>
                  <span className="font-medium">Dental Cleaning</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Preferred</span>
                  <span className="font-medium">Tue, 2:00 PM</span>
                </div>
                <div className="pt-2 border-t border-gray-200">
                  <span className="text-xs text-green-600 font-medium">
                    Captured via ReceptionistAI
                  </span>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
