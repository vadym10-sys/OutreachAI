"use client";

import { BarChart, Bar, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const data = [
  { day: "Mon", opens: 52, replies: 12, clicks: 19 },
  { day: "Tue", opens: 61, replies: 18, clicks: 26 },
  { day: "Wed", opens: 58, replies: 15, clicks: 23 },
  { day: "Thu", opens: 67, replies: 22, clicks: 31 },
  { day: "Fri", opens: 64, replies: 19, clicks: 28 }
];

export default function AnalyticsPage() {
  return (
    <div>
      <h1 className="text-3xl font-bold">Analytics</h1>
      <p className="mt-2 text-slate-600">Open, click, reply, conversion, and ROI reporting.</p>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section className="h-80 rounded-lg border border-slate-200 bg-white p-5">
          <h2 className="font-bold">Engagement trend</h2>
          <ResponsiveContainer width="100%" height="85%">
            <LineChart data={data}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="day" /><YAxis /><Tooltip /><Line type="monotone" dataKey="opens" stroke="#0f766e" /><Line type="monotone" dataKey="replies" stroke="#f97316" /></LineChart>
          </ResponsiveContainer>
        </section>
        <section className="h-80 rounded-lg border border-slate-200 bg-white p-5">
          <h2 className="font-bold">Clicks by day</h2>
          <ResponsiveContainer width="100%" height="85%">
            <BarChart data={data}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="day" /><YAxis /><Tooltip /><Bar dataKey="clicks" fill="#0284c7" /></BarChart>
          </ResponsiveContainer>
        </section>
      </div>
    </div>
  );
}
