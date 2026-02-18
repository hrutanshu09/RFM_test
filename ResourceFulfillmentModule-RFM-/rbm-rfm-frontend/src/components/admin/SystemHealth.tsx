// import React from "react";

// interface SystemHealthProps {
//     expanded?: boolean;
// }

// const SystemHealth: React.FC<SystemHealthProps> = ({ expanded }) => {
//     return (
//         <div className="system-health-container" style={{ marginTop: "20px", padding: "20px", background: "white", borderRadius: "8px", border: "1px solid #e5e7eb" }}>
//             <h3 style={{ fontSize: "1.1rem", fontWeight: 600, marginBottom: "15px" }}>System Health Status</h3>

//             <div className="health-grid" style={{ display: "grid", gap: "15px", gridTemplateColumns: expanded ? "repeat(auto-fit, minmax(250px, 1fr))" : "1fr" }}>
//                 <div className="health-item">
//                     <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "5px" }}>
//                         <span>CPU Usage</span>
//                         <span style={{ color: "green" }}>24%</span>
//                     </div>
//                     <div style={{ height: "8px", background: "#f3f4f6", borderRadius: "4px", overflow: "hidden" }}>
//                         <div style={{ width: "24%", background: "#10b981", height: "100%" }}></div>
//                     </div>
//                 </div>

//                 <div className="health-item">
//                     <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "5px" }}>
//                         <span>Memory Usage</span>
//                         <span style={{ color: "orange" }}>68%</span>
//                     </div>
//                     <div style={{ height: "8px", background: "#f3f4f6", borderRadius: "4px", overflow: "hidden" }}>
//                         <div style={{ width: "68%", background: "#f59e0b", height: "100%" }}></div>
//                     </div>
//                 </div>

//                 <div className="health-item">
//                     <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "5px" }}>
//                         <span>Disk Usage</span>
//                         <span style={{ color: "green" }}>45%</span>
//                     </div>
//                     <div style={{ height: "8px", background: "#f3f4f6", borderRadius: "4px", overflow: "hidden" }}>
//                         <div style={{ width: "45%", background: "#10b981", height: "100%" }}></div>
//                     </div>
//                 </div>
//             </div>

//             {expanded && (
//                 <div className="detailed-health" style={{ marginTop: "20px", paddingTop: "20px", borderTop: "1px solid #e5e7eb" }}>
//                     <p style={{ color: "#6b7280", fontSize: "0.9rem" }}>Last system check: Just now</p>
//                     {/* More detailed stats would go here */}
//                 </div>
//             )}
//         </div>
//     );
// };

// export default SystemHealth;
