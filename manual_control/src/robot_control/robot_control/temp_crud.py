# crud_knowledge.py
from sqlalchemy.orm import Session
from sqlalchemy.sql import text
from typing import Optional, Dict, List

class KnowledgeCRUD:
    @staticmethod
    def get_all_knowledge(db: Session) -> List[Dict]:
        """获取所有知识条目"""
        result = db.execute(text("SELECT * FROM knowledge"))
        print(result)
        return result.mappings().all()

    @staticmethod
    def get_knowledge_by_id(db: Session, knowledge_id: int) -> Optional[Dict]:
        """根据ID查询单条知识"""
        result = db.execute(
            text("SELECT * FROM knowledge WHERE id = :knowledge_id"),
            {"knowledge_id": knowledge_id}
        )
        return result.mappings().first()  # 自动返回 None 如果无结果

    @staticmethod
    def insert_knowledge(
        db: Session,
        answer_type: str,
        question: str,
        answer: str,
        group_id: Optional[int] = None,
        target: Optional[str] = None
    ) -> None:
        """创建知识条目"""
        # 动态处理 group_id 是否存在
        if group_id is not None:
            sql = """
                INSERT INTO knowledge 
                    (type, question, answer, group_id, target)
                VALUES 
                    (:type, :question, :answer, :group_id, :target)
            """
            params = {
                "type": answer_type,
                "question": question,
                "answer": answer,
                "group_id": group_id,
                "target": target
            }
        else:
            sql = """
                INSERT INTO knowledge 
                    (type, question, answer, target)
                VALUES 
                    (:type, :question, :answer, :target)
            """
            params = {
                "type": answer_type,
                "question": question,
                "answer": answer,
                "target": target
            }
        db.execute(text(sql), params)
        db.commit()

    @staticmethod
    def delete_knowledge(db: Session, knowledge_id: int) -> int:
        """删除知识条目，返回受影响行数"""
        result = db.execute(
            text("DELETE FROM knowledge WHERE id = :knowledge_id"),
            {"knowledge_id": knowledge_id}
        )
        db.commit()
        return result.rowcount

    @staticmethod
    def update_knowledge(
        db: Session,
        knowledge_id: int,
        answer_type: str,
        question: str,
        answer: str,
        target: Optional[str] = None,
        group_id: Optional[int] = None
    ) -> int:
        """更新知识条目，返回受影响行数"""
        # 动态构建 SET 子句
        set_clauses = [
            "type = :type",
            "question = :question",
            "answer = :answer"
        ]
        params = {
            "type": answer_type,
            "question": question,
            "answer": answer,
            "knowledge_id": knowledge_id
        }

        if group_id is not None:
            set_clauses.append("group_id = :group_id")
            params["group_id"] = group_id
        
        if target is not None:
            set_clauses.append("target = :target")
            params["target"] = target

        sql = f"""
            UPDATE knowledge
            SET {', '.join(set_clauses)}
            WHERE id = :knowledge_id
        """
        
        result = db.execute(text(sql), params)
        return result.rowcount
    
    @staticmethod
    def get_action_groups(db:Session):
        result = db.execute(text("SELECT ID,NAME FROM ACTIONS_GROUP"))
        return result.mappings().all()
    
    @staticmethod
    def check_action_group_exist(db:Session,group_id:int) -> Optional[Dict]:
        result = db.execute(text("SELECT ID FROM ACTIONS_GROUP where id = :group_id"),{"group_id": group_id})
        return result.mappings().first()