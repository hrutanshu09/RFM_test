// // rbm-rfm-frontend/src/components/admin/RolePermissionManager.tsx
// import React, { useState, useEffect } from "react";
// import { UserPlus, Key, Shield } from "lucide-react";

// interface User {
//   id: number;
//   username: string;
//   email: string;
//   fullName: string;
//   department: string;
//   roles: string[];
//   lastLogin: string;
//   isActive: boolean;
// }

// interface Role {
//   id: number;
//   name: string;
//   description: string;
//   permissions: string[];
//   userCount: number;
// }

// // Mock data
// const mockUsers: User[] = [
//   {
//     id: 1,
//     username: "john.doe",
//     email: "john@company.com",
//     fullName: "John Doe",
//     department: "HR",
//     roles: ["hr", "user"],
//     lastLogin: "2024-01-20 14:30",
//     isActive: true,
//   },
//   {
//     id: 2,
//     username: "jane.smith",
//     email: "jane@company.com",
//     fullName: "Jane Smith",
//     department: "Finance",
//     roles: ["finance", "user"],
//     lastLogin: "2024-01-20 09:15",
//     isActive: true,
//   },
//   {
//     id: 3,
//     username: "bob.wilson",
//     email: "bob@company.com",
//     fullName: "Bob Wilson",
//     department: "IT",
//     roles: ["admin", "user"],
//     lastLogin: "2024-01-19 16:45",
//     isActive: true,
//   },
// ];

// const mockRoles: Role[] = [
//   {
//     id: 1,
//     name: "admin",
//     description: "Full system access",
//     permissions: ["read", "write", "delete", "admin"],
//     userCount: 3,
//   },
//   {
//     id: 2,
//     name: "manager",
//     description: "Team management",
//     permissions: ["read", "write"],
//     userCount: 12,
//   },
//   {
//     id: 3,
//     name: "hr",
//     description: "Human Resources access",
//     permissions: ["read", "write_hr"],
//     userCount: 5,
//   },
//   {
//     id: 4,
//     name: "finance",
//     description: "Financial data access",
//     permissions: ["read_finance"],
//     userCount: 4,
//   },
//   {
//     id: 5,
//     name: "user",
//     description: "Basic user access",
//     permissions: ["read"],
//     userCount: 45,
//   },
// ];

// const RolePermissionManager: React.FC = () => {
//   const [users, setUsers] = useState<User[]>(mockUsers);
//   const [roles] = useState<Role[]>(mockRoles);
//   const [selectedUser, setSelectedUser] = useState<User | null>(null);
//   const [showUserModal, setShowUserModal] = useState(false);
//   const [showRoleModal, setShowRoleModal] = useState(false);
//   // Prevent unused variable warning for mock setRoles and showRoleModal by using them
//   useEffect(() => {
//     if (showRoleModal) {
//       // Placeholder for role modal logic
//       console.log("Roles modal open", roles);
//     }
//   }, [showRoleModal, roles]);

//   const [newUser, setNewUser] = useState({
//     username: "",
//     email: "",
//     fullName: "",
//     department: "",
//     initialRole: "user",
//   });

//   const handleAssignRole = (userId: number, roleName: string) => {
//     // Update local state
//     setUsers(users.map(user => {
//       if (user.id === userId && !user.roles.includes(roleName)) {
//         return { ...user, roles: [...user.roles, roleName] };
//       }
//       return user;
//     }));

//     // Update selected user if it's the one being modified
//     if (selectedUser && selectedUser.id === userId) {
//       setSelectedUser(prev => prev ? ({
//         ...prev,
//         roles: [...prev.roles, roleName]
//       }) : null);
//     }
//   };

//   const handleRevokeRole = (userId: number, roleName: string) => {
//     // Update local state
//     setUsers(users.map(user => {
//       if (user.id === userId) {
//         return { ...user, roles: user.roles.filter(r => r !== roleName) };
//       }
//       return user;
//     }));

//     // Update selected user if it's the one being modified
//     if (selectedUser && selectedUser.id === userId) {
//       setSelectedUser(prev => prev ? ({
//         ...prev,
//         roles: prev.roles.filter(r => r !== roleName)
//       }) : null);
//     }
//   };

//   const handleCreateUser = () => {
//     const newUserObj: User = {
//       id: users.length + 1,
//       username: newUser.username,
//       email: newUser.email,
//       fullName: newUser.fullName,
//       department: newUser.department,
//       roles: [newUser.initialRole],
//       lastLogin: "Never",
//       isActive: true,
//     };

//     setUsers([...users, newUserObj]);
//     setShowUserModal(false);
//     setNewUser({
//       username: "",
//       email: "",
//       fullName: "",
//       department: "",
//       initialRole: "user",
//     });
//   };

//   return (
//     <div className="role-permission-manager">
//       <div className="manager-header">
//         <div className="header-left">
//           <h2>Role & Permission Management</h2>
//           <p className="subtitle">Manage user access and role assignments</p>
//         </div>
//         <div className="header-actions">
//           <button
//             className="action-button primary"
//             onClick={() => setShowUserModal(true)}
//           >
//             <UserPlus size={16} />
//             Add User
//           </button>
//           <button
//             className="action-button secondary"
//             onClick={() => setShowRoleModal(true)}
//           >
//             <Key size={16} />
//             Manage Roles
//           </button>
//         </div>
//       </div>

//       <div className="manager-grid">
//         {/* Users Panel */}
//         <div className="users-panel">
//           <div className="panel-header">
//             <h3>Users ({users.length})</h3>
//             <div className="search-box">
//               <input type="text" placeholder="Search users..." />
//             </div>
//           </div>
//           <div className="users-list">
//             {users.map((user) => (
//               <div
//                 key={user.id}
//                 className={`user-card ${selectedUser?.id === user.id ? "selected" : ""}`}
//                 onClick={() => setSelectedUser(user)}
//               >
//                 <div className="user-avatar">{user.fullName.charAt(0)}</div>
//                 <div className="user-info">
//                   <h4>{user.fullName}</h4>
//                   <p className="user-username">@{user.username}</p>
//                   <p className="user-department">{user.department}</p>
//                 </div>
//                 <div className="user-roles">
//                   {user.roles.map((role) => (
//                     <span key={role} className="role-tag">
//                       {role}
//                     </span>
//                   ))}
//                 </div>
//               </div>
//             ))}
//           </div>
//         </div>

//         {/* Permissions Panel */}
//         <div className="permissions-panel">
//           {selectedUser ? (
//             <>
//               <div className="selected-user-header">
//                 <h3>{selectedUser.fullName}</h3>
//                 <span className="user-status active">Active</span>
//               </div>

//               <div className="current-roles">
//                 <h4>Current Roles</h4>
//                 <div className="roles-list">
//                   {selectedUser.roles.map((role) => (
//                     <div key={role} className="role-item">
//                       <span className="role-name">{role}</span>
//                       <button
//                         className="revoke-button"
//                         onClick={() => handleRevokeRole(selectedUser.id, role)}
//                       >
//                         Revoke
//                       </button>
//                     </div>
//                   ))}
//                 </div>
//               </div>

//               <div className="available-roles">
//                 <h4>Available Roles</h4>
//                 <div className="roles-grid">
//                   {roles
//                     .filter((role) => !selectedUser.roles.includes(role.name))
//                     .map((role) => (
//                       <div key={role.id} className="role-option">
//                         <div className="role-info">
//                           <Shield size={16} />
//                           <div>
//                             <h5>{role.name}</h5>
//                             <p>{role.description}</p>
//                           </div>
//                         </div>
//                         <button
//                           className="assign-button"
//                           onClick={() =>
//                             handleAssignRole(selectedUser.id, role.name)
//                           }
//                         >
//                           Assign
//                         </button>
//                       </div>
//                     ))}
//                 </div>
//               </div>

//               <div className="permission-summary">
//                 <h4>Effective Permissions</h4>
//                 <div className="permissions-list">
//                   {selectedUser.roles
//                     .flatMap((roleName) => {
//                       const role = roles.find((r) => r.name === roleName);
//                       return role ? role.permissions : [];
//                     })
//                     .map((permission, index) => (
//                       <span key={index} className="permission-tag">
//                         {permission}
//                       </span>
//                     ))}
//                 </div>
//               </div>
//             </>
//           ) : (
//             <div className="no-selection">
//               <Shield size={48} />
//               <p>Select a user to manage their roles and permissions</p>
//             </div>
//           )}
//         </div>
//       </div>

//       {/* Add User Modal */}
//       {showUserModal && (
//         <div className="modal-overlay">
//           <div className="modal-content">
//             <div className="modal-header">
//               <h3>Create New User</h3>
//               <button
//                 className="close-button"
//                 onClick={() => setShowUserModal(false)}
//               >
//                 ×
//               </button>
//             </div>
//             <div className="modal-body">
//               <div className="form-grid">
//                 <div className="form-group">
//                   <label>Username *</label>
//                   <input
//                     type="text"
//                     value={newUser.username}
//                     onChange={(e) =>
//                       setNewUser({ ...newUser, username: e.target.value })
//                     }
//                     placeholder="john.doe"
//                   />
//                 </div>
//                 <div className="form-group">
//                   <label>Email *</label>
//                   <input
//                     type="email"
//                     value={newUser.email}
//                     onChange={(e) =>
//                       setNewUser({ ...newUser, email: e.target.value })
//                     }
//                     placeholder="john@company.com"
//                   />
//                 </div>
//                 <div className="form-group">
//                   <label>Full Name *</label>
//                   <input
//                     type="text"
//                     value={newUser.fullName}
//                     onChange={(e) =>
//                       setNewUser({ ...newUser, fullName: e.target.value })
//                     }
//                     placeholder="John Doe"
//                   />
//                 </div>
//                 <div className="form-group">
//                   <label>Department</label>
//                   <select
//                     value={newUser.department}
//                     onChange={(e) =>
//                       setNewUser({ ...newUser, department: e.target.value })
//                     }
//                   >
//                     <option value="">Select Department</option>
//                     <option value="HR">Human Resources</option>
//                     <option value="IT">Information Technology</option>
//                     <option value="Finance">Finance</option>
//                     <option value="Operations">Operations</option>
//                   </select>
//                 </div>
//                 <div className="form-group full-width">
//                   <label>Initial Role *</label>
//                   <div className="role-options">
//                     {roles.map((role) => (
//                       <label key={role.id} className="role-option-radio">
//                         <input
//                           type="radio"
//                           name="initialRole"
//                           value={role.name}
//                           checked={newUser.initialRole === role.name}
//                           onChange={(e) =>
//                             setNewUser({
//                               ...newUser,
//                               initialRole: e.target.value,
//                             })
//                           }
//                         />
//                         <span className="radio-label">{role.name}</span>
//                         <span className="role-description">
//                           {role.description}
//                         </span>
//                       </label>
//                     ))}
//                   </div>
//                 </div>
//               </div>
//             </div>
//             <div className="modal-footer">
//               <button
//                 className="cancel-button"
//                 onClick={() => setShowUserModal(false)}
//               >
//                 Cancel
//               </button>
//               <button className="save-button" onClick={handleCreateUser}>
//                 Create User
//               </button>
//             </div>
//           </div>
//         </div>
//       )}
//     </div>
//   );
// };

// export default RolePermissionManager;
