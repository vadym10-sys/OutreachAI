CREATE TABLE IF NOT EXISTS sales_employee_task_results (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id VARCHAR(128) NOT NULL,
  sales_employee_id UUID NOT NULL REFERENCES ai_sales_employees(id) ON DELETE CASCADE,
  task_id VARCHAR(80) UNIQUE NOT NULL,
  command TEXT NOT NULL DEFAULT '',
  status VARCHAR(40) NOT NULL DEFAULT 'finished',
  result_json JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  completed_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sales_employee_task_results_workspace_id ON sales_employee_task_results(workspace_id);
CREATE INDEX IF NOT EXISTS idx_sales_employee_task_results_user_id ON sales_employee_task_results(user_id);
CREATE INDEX IF NOT EXISTS idx_sales_employee_task_results_employee_id ON sales_employee_task_results(sales_employee_id);
CREATE INDEX IF NOT EXISTS idx_sales_employee_task_results_task_id ON sales_employee_task_results(task_id);
