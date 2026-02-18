// rbm-rfm-frontend/src/components/admin/MasterDataManager.tsx
import React, { useState, useEffect } from "react";
import {
  Plus,
  Edit,
  Trash2,
  Search,
  Filter,
  Download,
  Upload,
} from "lucide-react";
import { apiClient } from "../../api/client";

type MasterDataType =
  | "skill"
  | "location"
  | "department"
  | "company_role"
  | "technology";

interface MasterDataItem {
  id: number;
  name: string;
  type: MasterDataType;
  description: string;
  createdBy: string;
  createdAt: string;
  isActive: boolean;
}

type SkillResponse = {
  skill_id: number;
  skill_name: string;
  created_by?: string | null;
  created_at?: string | null;
};

type DepartmentResponse = {
  department_id: number;
  department_name: string;
  created_by?: string | null;
  created_at?: string | null;
};

type LocationResponse = {
  location_id: number;
  city?: string | null;
  country?: string | null;
  created_by?: string | null;
  created_at?: string | null;
};

type CompanyRoleResponse = {
  role_id: number;
  role_name: string;
  role_description?: string | null;
  is_active: boolean;
  created_at?: string | null;
};

type NewItemState = {
  name: string;
  description: string;
  type: Exclude<MasterDataType, "technology">;
};

const normalizeItem = (item: MasterDataItem): MasterDataItem => ({
  ...item,
  createdBy: item.createdBy || "System",
  createdAt: item.createdAt || "-",
  isActive: item.isActive ?? true,
});

const formatDate = (value?: string | null) => {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleDateString();
};

const MasterDataManager: React.FC = () => {
  const [activeTab, setActiveTab] = useState<
    "skills" | "locations" | "departments" | "company-roles"
  >("skills");
  const [skills, setSkills] = useState<MasterDataItem[]>([]);
  const [locations, setLocations] = useState<MasterDataItem[]>([]);
  const [departments, setDepartments] = useState<MasterDataItem[]>([]);
  const [companyRoles, setCompanyRoles] = useState<MasterDataItem[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingItem, setEditingItem] = useState<MasterDataItem | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newItem, setNewItem] = useState<NewItemState>({
    name: "",
    description: "",
    type: "skill",
  });
  const fetchSkills = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await apiClient.get<SkillResponse[]>("/skills/");
      const mapped = response.data.map((skill) =>
        normalizeItem({
          id: skill.skill_id,
          name: skill.skill_name,
          type: "skill",
          description: "",
          createdBy: skill.created_by ?? "System",
          createdAt: formatDate(skill.created_at),
          isActive: true,
        }),
      );
      setSkills(mapped);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to load skills";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchDepartments = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response =
        await apiClient.get<DepartmentResponse[]>("/departments/");
      const mapped = response.data.map((dept) =>
        normalizeItem({
          id: dept.department_id,
          name: dept.department_name,
          type: "department",
          description: "",
          createdBy: dept.created_by ?? "System",
          createdAt: formatDate(dept.created_at),
          isActive: true,
        }),
      );
      setDepartments(mapped);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to load departments";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchLocations = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await apiClient.get<LocationResponse[]>("/locations/");
      const mapped = response.data.map((loc) =>
        normalizeItem({
          id: loc.location_id,
          name: loc.city || "Unknown",
          type: "location",
          description: loc.country || "",
          createdBy: loc.created_by ?? "System",
          createdAt: formatDate(loc.created_at),
          isActive: true,
        }),
      );
      setLocations(mapped);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to load locations";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchCompanyRoles = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response =
        await apiClient.get<CompanyRoleResponse[]>("/company-roles/");
      const mapped = response.data.map((role) =>
        normalizeItem({
          id: role.role_id,
          name: role.role_name,
          type: "company_role",
          description: role.role_description ?? "",
          createdBy: "System",
          createdAt: formatDate(role.created_at),
          isActive: role.is_active ?? true,
        }),
      );
      setCompanyRoles(mapped);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to load company roles";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === "skills") {
      fetchSkills();
      setNewItem((prev) => ({ ...prev, type: "skill" }));
    } else if (activeTab === "locations") {
      fetchLocations();
      setNewItem((prev) => ({ ...prev, type: "location" }));
    } else if (activeTab === "departments") {
      fetchDepartments();
      setNewItem((prev) => ({ ...prev, type: "department" }));
    } else {
      fetchCompanyRoles();
      setNewItem((prev) => ({ ...prev, type: "company_role" }));
    }
  }, [activeTab]);

  const handleAddItem = async () => {
    if (!newItem.name.trim()) {
      window.alert("Name is required.");
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      if (activeTab === "skills") {
        await apiClient.post("/skills/", {
          skill_name: newItem.name.trim(),
        });
        await fetchSkills();
      } else if (activeTab === "departments") {
        await apiClient.post("/departments/", {
          department_name: newItem.name.trim(),
        });
        await fetchDepartments();
      } else if (activeTab === "company-roles") {
        await apiClient.post("/company-roles/", {
          role_name: newItem.name.trim(),
          role_description: newItem.description.trim() || null,
        });
        await fetchCompanyRoles();
      } else {
        await apiClient.post("/locations/", {
          city: newItem.name.trim(),
          country: newItem.description.trim() || null,
        });
        await fetchLocations();
      }

      setShowAddModal(false);
      setNewItem({ name: "", description: "", type: "skill" });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to add item";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteItem = async (id: number) => {
    if (!window.confirm("Are you sure you want to delete this item?")) {
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      if (activeTab === "skills") {
        await apiClient.delete(`/skills/${id}`);
        await fetchSkills();
      } else if (activeTab === "departments") {
        await apiClient.delete(`/departments/${id}`);
        await fetchDepartments();
      } else if (activeTab === "company-roles") {
        await apiClient.delete(`/company-roles/${id}`);
        await fetchCompanyRoles();
      } else {
        await apiClient.delete(`/locations/${id}`);
        await fetchLocations();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to delete";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleEditItem = (item: MasterDataItem) => {
    setEditingItem(item);
    setShowEditModal(true);
  };

  const handleSaveEdit = async () => {
    if (!editingItem || !editingItem.name.trim()) {
      window.alert("Name is required.");
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      if (editingItem.type === "skill") {
        await apiClient.patch(`/skills/${editingItem.id}`, {
          skill_name: editingItem.name.trim(),
        });
        await fetchSkills();
      } else if (editingItem.type === "department") {
        await apiClient.patch(`/departments/${editingItem.id}`, {
          department_name: editingItem.name.trim(),
        });
        await fetchDepartments();
      } else if (editingItem.type === "company_role") {
        await apiClient.patch(`/company-roles/${editingItem.id}`, {
          role_name: editingItem.name.trim(),
          role_description: editingItem.description.trim() || null,
        });
        await fetchCompanyRoles();
      } else {
        await apiClient.patch(`/locations/${editingItem.id}`, {
          city: editingItem.name.trim(),
          country: editingItem.description.trim() || null,
        });
        await fetchLocations();
      }

      setShowEditModal(false);
      setEditingItem(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to update";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  const currentItems =
    activeTab === "skills"
      ? skills
      : activeTab === "locations"
        ? locations
        : activeTab === "company-roles"
          ? companyRoles
          : departments;

  const filteredItems = currentItems.filter((item) =>
    item.name.toLowerCase().includes(searchTerm.toLowerCase()),
  );

  return (
    <div className="master-data-manager">
      <div className="data-manager-header">
        <div className="header-left">
          <h2>Master Data Management</h2>
          <p className="subtitle">
            Curate dropdown options for{" "}
            <strong>Skills, Locations, Departments, and Company Roles</strong>.
          </p>
        </div>
        <button className="add-button" onClick={() => setShowAddModal(true)}>
          <Plus size={16} />
          Add New
        </button>
      </div>

      {/* Tabs */}
      <div className="data-tabs">
        <button
          className={`tab-button ${activeTab === "skills" ? "active" : ""}`}
          onClick={() => setActiveTab("skills")}
        >
          <span>Skills</span>
          <span className="tab-count">{skills.length}</span>
        </button>
        <button
          className={`tab-button ${activeTab === "locations" ? "active" : ""}`}
          onClick={() => setActiveTab("locations")}
        >
          <span>Locations</span>
          <span className="tab-count">{locations.length}</span>
        </button>
        <button
          className={`tab-button ${activeTab === "departments" ? "active" : ""}`}
          onClick={() => setActiveTab("departments")}
        >
          <span>Departments</span>
          <span className="tab-count">{departments.length}</span>
        </button>
        <button
          className={`tab-button ${
            activeTab === "company-roles" ? "active" : ""
          }`}
          onClick={() => setActiveTab("company-roles")}
        >
          <span>Company Roles</span>
          <span className="tab-count">{companyRoles.length}</span>
        </button>
      </div>

      {/* Search */}
      <div className="data-controls">
        <div className="search-box">
          <Search size={18} />
          <input
            type="text"
            placeholder={`Search ${activeTab.replace("-", " ")}...`}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        {/* <div className="control-buttons">
          <button className="control-button">
            <Filter size={16} />
            Filter
          </button>
          <button className="control-button">
            <Download size={16} />
            Export
          </button>
          <button className="control-button">
            <Upload size={16} />
            Import
          </button>
        </div> */}
      </div>

      {/* Data Table */}
      <div className="data-table-container">
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Created By</th>
              <th>Created At</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={4} className="table-loading">
                  Loading {activeTab}...
                </td>
              </tr>
            )}
            {filteredItems.map((item) => (
              <tr key={item.id}>
                <td>
                  <div className="item-name">{item.name}</div>
                </td>
                <td>{item.createdBy}</td>
                <td>{item.createdAt}</td>
                <td>
                  <div className="action-buttons">
                    <button
                      className="action-button edit"
                      title="Edit"
                      onClick={() => handleEditItem(item)}
                    >
                      <Edit size={14} />
                    </button>
                    <button
                      className="action-button delete"
                      title="Delete"
                      onClick={() => handleDeleteItem(item.id)}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!isLoading && filteredItems.length === 0 && (
          <div className="empty-state">
            <p>
              {error ? error : `No ${activeTab} found. Add your first item!`}
            </p>
          </div>
        )}
      </div>

      {/* Add New Item Modal */}
      {showAddModal && (
        <div className="modal-overlay">
          <div className="modal-content edit-user-modal">
            <div className="modal-header">
              <div>
                <h3>Add New {activeTab.slice(0, -1)}</h3>
                <p className="modal-subtitle">
                  Provide the details for the new {activeTab.slice(0, -1)}
                </p>
              </div>
              <button
                className="close-button"
                onClick={() => setShowAddModal(false)}
              >
                ×
              </button>
            </div>
            <div className="modal-body edit-user-body">
              <div className="edit-user-section">
                <div className="section-header">
                  <h4>Details</h4>
                  <p>Fill in the required information</p>
                </div>
                <div className="form-group">
                  <label>Name *</label>
                  <input
                    type="text"
                    value={newItem.name}
                    onChange={(e) =>
                      setNewItem({ ...newItem, name: e.target.value })
                    }
                    placeholder={`Enter ${activeTab.slice(0, -1)} name`}
                  />
                </div>
                {activeTab === "locations" && (
                  <div className="form-group">
                    <label>Country</label>
                    <input
                      type="text"
                      value={newItem.description}
                      onChange={(e) =>
                        setNewItem({
                          ...newItem,
                          description: e.target.value,
                        })
                      }
                      placeholder="Enter country"
                    />
                  </div>
                )}
                {activeTab === "company-roles" && (
                  <div className="form-group">
                    <label>Description</label>
                    <input
                      type="text"
                      value={newItem.description}
                      onChange={(e) =>
                        setNewItem({
                          ...newItem,
                          description: e.target.value,
                        })
                      }
                      placeholder="Enter role description"
                    />
                  </div>
                )}
              </div>
            </div>
            <div className="modal-footer">
              <button
                className="cancel-button"
                onClick={() => setShowAddModal(false)}
              >
                Cancel
              </button>
              <button className="save-button" onClick={handleAddItem}>
                Save {activeTab.slice(0, -1)}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Item Modal */}
      {showEditModal && editingItem && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <h3>Edit {editingItem.type}</h3>
              <button
                className="close-button"
                onClick={() => {
                  setShowEditModal(false);
                  setEditingItem(null);
                }}
              >
                ×
              </button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Name *</label>
                <input
                  type="text"
                  value={editingItem.name}
                  onChange={(e) =>
                    setEditingItem({
                      ...editingItem,
                      name: e.target.value,
                    })
                  }
                  placeholder={`Enter ${editingItem.type} name`}
                />
              </div>
              {editingItem.type === "location" && (
                <div className="form-group">
                  <label>Country</label>
                  <input
                    type="text"
                    value={editingItem.description}
                    onChange={(e) =>
                      setEditingItem({
                        ...editingItem,
                        description: e.target.value,
                      })
                    }
                    placeholder="Enter country"
                  />
                </div>
              )}
              {editingItem.type === "company_role" && (
                <div className="form-group">
                  <label>Description</label>
                  <input
                    type="text"
                    value={editingItem.description}
                    onChange={(e) =>
                      setEditingItem({
                        ...editingItem,
                        description: e.target.value,
                      })
                    }
                    placeholder="Enter role description"
                  />
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button
                className="cancel-button"
                onClick={() => {
                  setShowEditModal(false);
                  setEditingItem(null);
                }}
              >
                Cancel
              </button>
              <button className="save-button" onClick={handleSaveEdit}>
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MasterDataManager;
