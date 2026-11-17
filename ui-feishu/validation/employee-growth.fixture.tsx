import { createRoot } from "react-dom/client";
import { EmployeeGrowthPanel } from "../shared/features/employee-growth/components/EmployeeGrowthPanel";

createRoot(document.getElementById("root")!).render(<EmployeeGrowthPanel employeeId="developer" />);
