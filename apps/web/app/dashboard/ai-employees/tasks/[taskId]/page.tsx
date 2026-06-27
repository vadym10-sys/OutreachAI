import { TaskResultClient } from '@/components/task-result-client';

export default async function TaskResultPage({ params }: { params: Promise<{ taskId: string }> }) {
  const { taskId } = await params;
  return <TaskResultClient taskId={taskId} />;
}
