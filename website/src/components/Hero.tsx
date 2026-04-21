"use client";

import { motion } from "framer-motion";

export default function Hero() {
  return (
    <section className="relative pt-32 pb-20 md:pt-40 md:pb-32 overflow-hidden">
      {/* Background gradient */}
      <div className="absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-gradient-to-b from-indigo-50/80 via-white to-white" />
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[600px] bg-gradient-to-br from-indigo-200/40 to-purple-200/30 rounded-full blur-3xl" />
      </div>

      <div className="max-w-7xl mx-auto px-6">
        <div className="max-w-4xl mx-auto text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-indigo-50 border border-indigo-100 text-indigo-700 text-sm font-medium mb-8">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-indigo-500" />
              </span>
              AI-Powered Receptionist
            </div>
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="text-5xl md:text-7xl font-bold tracking-tight leading-[1.1] mb-6"
          >
            Never miss a call.
            <br />
            <span className="bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent">
              Never lose a booking.
            </span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="text-lg md:text-xl text-gray-600 max-w-2xl mx-auto mb-10 leading-relaxed"
          >
            Your AI receptionist answers every call 24/7, captures customer
            details, and sends booking requests straight to your inbox — so you
            can focus on what matters.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.3 }}
            className="flex flex-col sm:flex-row items-center justify-center gap-4"
          >
            <a
              href="#cta"
              className="group relative inline-flex items-center gap-2 px-8 py-3.5 bg-gray-900 text-white font-medium rounded-full hover:bg-gray-800 transition-all hover:shadow-lg hover:shadow-gray-900/20"
            >
              Book a Demo
              <svg
                className="w-4 h-4 transition-transform group-hover:translate-x-0.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M13 7l5 5m0 0l-5 5m5-5H6"
                />
              </svg>
            </a>
            <a
              href="#how-it-works"
              className="inline-flex items-center gap-2 px-8 py-3.5 text-gray-700 font-medium rounded-full border border-gray-200 hover:border-gray-300 hover:bg-white transition-all"
            >
              See How It Works
            </a>
          </motion.div>
        </div>

        {/* Dashboard Mockup */}
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.5 }}
          className="mt-20 max-w-5xl mx-auto"
        >
          <div className="relative rounded-2xl border border-gray-200/80 bg-white shadow-2xl shadow-gray-200/50 overflow-hidden">
            <div className="flex items-center gap-2 px-5 py-3 border-b border-gray-100 bg-gray-50/50">
              <div className="flex gap-1.5">
                <div className="w-3 h-3 rounded-full bg-red-400" />
                <div className="w-3 h-3 rounded-full bg-yellow-400" />
                <div className="w-3 h-3 rounded-full bg-green-400" />
              </div>
              <div className="flex-1 flex justify-center">
                <div className="px-4 py-1 rounded-md bg-gray-100 text-xs text-gray-500 font-mono">
                  dashboard.receptionist-ai.com
                </div>
              </div>
            </div>
            <div className="p-6 md:p-8">
              {/* Simplified dashboard UI */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                {[
                  {
                    label: "Calls Today",
                    value: "47",
                    change: "+12%",
                    color: "text-green-600",
                  },
                  {
                    label: "Bookings Captured",
                    value: "23",
                    change: "+8%",
                    color: "text-green-600",
                  },
                  {
                    label: "Avg Response",
                    value: "0.3s",
                    change: "-45%",
                    color: "text-green-600",
                  },
                ].map((stat) => (
                  <div
                    key={stat.label}
                    className="rounded-xl border border-gray-100 p-4"
                  >
                    <p className="text-sm text-gray-500">{stat.label}</p>
                    <div className="flex items-end gap-2 mt-1">
                      <p className="text-2xl font-semibold">{stat.value}</p>
                      <span className={`text-xs font-medium ${stat.color}`}>
                        {stat.change}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
              {/* Recent calls */}
              <div className="rounded-xl border border-gray-100 overflow-hidden">
                <div className="px-4 py-3 bg-gray-50/50 border-b border-gray-100">
                  <p className="text-sm font-medium text-gray-700">
                    Recent Calls
                  </p>
                </div>
                {[
                  {
                    name: "Sarah Johnson",
                    time: "2 min ago",
                    status: "Booking sent",
                    statusColor: "bg-green-100 text-green-700",
                  },
                  {
                    name: "Mike Chen",
                    time: "15 min ago",
                    status: "Details captured",
                    statusColor: "bg-blue-100 text-blue-700",
                  },
                  {
                    name: "Emily Davis",
                    time: "1 hr ago",
                    status: "Booking sent",
                    statusColor: "bg-green-100 text-green-700",
                  },
                ].map((call, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between px-4 py-3 border-b border-gray-50 last:border-0"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-100 to-purple-100 flex items-center justify-center text-sm font-medium text-indigo-700">
                        {call.name[0]}
                      </div>
                      <div>
                        <p className="text-sm font-medium">{call.name}</p>
                        <p className="text-xs text-gray-400">{call.time}</p>
                      </div>
                    </div>
                    <span
                      className={`text-xs font-medium px-2.5 py-1 rounded-full ${call.statusColor}`}
                    >
                      {call.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
