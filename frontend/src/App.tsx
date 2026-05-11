import { Outlet } from 'react-router-dom';

import { AdminLayout } from './layouts/AdminLayout';

export default function App() {
  return (
    <AdminLayout>
      <Outlet />
    </AdminLayout>
  );
}
