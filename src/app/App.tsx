import { MapPinned } from 'lucide-react'
import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'

import { WorkspaceShell } from './WorkspaceShell'
import { EmptyState, PageShell } from '@/features/trips/feature-ui'
import { ProtectedRoute } from '@/features/auth/ProtectedRoute'

const TripsPage = lazy(() => import('@/features/trips/TripsPage').then((module) => ({ default: module.TripsPage })))
const NewTripPage = lazy(() => import('@/features/trips/NewTripPage').then((module) => ({ default: module.NewTripPage })))
const PlanPage = lazy(() => import('@/features/planner/PlanPage').then((module) => ({ default: module.PlanPage })))
const BudgetPage = lazy(() => import('@/features/budget/BudgetPage').then((module) => ({ default: module.BudgetPage })))
const ChangeSetPage = lazy(() => import('@/features/changesets/ChangeSetPage').then((module) => ({ default: module.ChangeSetPage })))
const ReportsPage = lazy(() => import('@/features/reports/ReportsPage').then((module) => ({ default: module.ReportsPage })))
const SettingsPage = lazy(() => import('@/features/settings/SettingsPage').then((module) => ({ default: module.SettingsPage })))
const SourcesPage = lazy(() => import('@/features/sources/SourcesPage').then((module) => ({ default: module.SourcesPage })))
const TodayPage = lazy(() => import('@/features/today/TodayPage').then((module) => ({ default: module.TodayPage })))
const VersionsPage = lazy(() => import('@/features/versions/VersionsPage').then((module) => ({ default: module.VersionsPage })))
const SharePage = lazy(() => import('@/features/share/SharePage').then((module) => ({ default: module.SharePage })))
const PublicTripPage = lazy(() => import('@/features/share/PublicTripPage').then((module) => ({ default: module.PublicTripPage })))
const PublicReportPage = lazy(() => import('@/features/share/PublicReportPage').then((module) => ({ default: module.PublicReportPage })))
const LoginPage = lazy(() => import('@/features/auth/LoginPage').then((module) => ({ default: module.LoginPage })))

function NotFoundPage() {
  return (
    <PageShell width="reading">
      <EmptyState
        icon={MapPinned}
        title="没有找到这个页面"
        description="链接可能已更新，回到路书列表继续规划。"
        action={<a className="feature-button feature-button--primary" href="/trips">返回我的路书</a>}
      />
    </PageShell>
  )
}

export function App() {
  return (
    <Suspense fallback={<div className="app-route-loading" role="status">正在打开路书…</div>}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<ProtectedRoute />}>
          <Route path="/" element={<Navigate to="/trips" replace />} />
          <Route path="/trips" element={<TripsPage />} />
          <Route path="/trips/new" element={<NewTripPage />} />
          <Route path="/trips/:tripId/plan" element={<PlanPage />} />
          <Route path="/trips/:tripId" element={<WorkspaceShell />}>
            <Route index element={<Navigate to="plan" replace />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="budget" element={<BudgetPage />} />
            <Route path="sources" element={<SourcesPage />} />
            <Route path="versions" element={<VersionsPage />} />
            <Route path="imports/:changeSetId" element={<ChangeSetPage />} />
            <Route path="today" element={<TodayPage />} />
            <Route path="reports" element={<ReportsPage />} />
            <Route path="share" element={<SharePage />} />
          </Route>
        </Route>
        <Route path="/s/:token" element={<PublicTripPage />} />
        <Route path="/r/:token" element={<PublicReportPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Suspense>
  )
}

export default App
