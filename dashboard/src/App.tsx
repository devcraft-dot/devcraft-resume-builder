import { Dashboard } from "./Dashboard";

export default function App() {
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-6 py-4">
        <h1 className="text-xl font-semibold text-gray-900">
          Resume Builder Dashboard
        </h1>
      </header>
      <main className="p-6">
        <Dashboard />
      </main>
    </div>
  );
}
