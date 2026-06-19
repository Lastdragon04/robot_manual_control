import sqlite3


class InvertedIndexSearcher:
    def __init__(self, db_path):
        self.db_path = db_path
        self._con = sqlite3.connect(db_path, check_same_thread=False)
        self._con.execute("PRAGMA journal_mode=WAL")
        self._con.execute("PRAGMA foreign_keys=ON")

    def _execute_query(self, query, params=None):
        cursor = self._con.cursor()
        try:
            if params:
                cursor.execute(query, params)
            else:
                cursor.execute(query)
            return cursor.fetchall()
        except sqlite3.Error as e:
            raise Exception(e)

    def change(self, query, params=None):
        cursor = self._con.cursor()
        try:
            if params:
                cursor.execute(query, params)
            else:
                cursor.execute(query)
            self._con.commit()
        except sqlite3.Error as e:
            raise Exception(e)

    def get_joint_position(self, robot_type):
        sql = """SELECT c.urdf_name, c.current_position, c.name_index
                 FROM control_config c
                 JOIN robot r ON c.robot_id = r.id
                 WHERE r.name = ? AND c.urdf_name IS NOT NULL AND c.urdf_name != ''
                 ORDER BY c.topic"""
        return self._execute_query(sql, (robot_type,))


if __name__ == "__main__":
    searcher = InvertedIndexSearcher('/home/zck/workspace/robot_manual_control/Memories/robot_control_v2.db')
    print(searcher.get_joint_position("天轶2.0Pro"))
