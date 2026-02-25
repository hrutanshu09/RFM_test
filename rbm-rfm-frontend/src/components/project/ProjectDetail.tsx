import React from 'react';
import { useParams } from 'react-router-dom';

const ProjectDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();

  return (
    <div style={{ padding: '20px' }}>
      <h2>Project Details: {id}</h2>
      <div className="card">
        <p>Project specific information and resource assignments will appear here.</p>
      </div>
      {/* We will integrate the Assignment components here next */}
    </div>
  );
};

export default ProjectDetail;