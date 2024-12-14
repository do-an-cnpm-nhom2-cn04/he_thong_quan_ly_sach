import express from "express";
import mysql from "mysql2/promise";
import bodyParser from "body-parser";
import multer from "multer";
import cors from "cors";
import path from "path"; // Required for handling file paths

const app = express();

// Enable CORS for all origins
app.use(cors());

// Parse incoming requests
app.use(bodyParser.json());


// MySQL connection pool
const pool = mysql.createPool({
  host: "localhost",      // MySQL server address
  port: 3306,             // MySQL server port
  user: "root",           // MySQL username
  password: "root",       // MySQL password
  database: "bkbooks",    // MySQL database
  waitForConnections: true,
  connectionLimit: 10,    // Maximum number of connections
  queueLimit: 0,
});

// Get Publishers
app.get('/getPublishers', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM publishers');
        res.json(rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error fetching publishers' });
    }
});

// Get Categories
app.get('/getCategories', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM categories');
        res.json(rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error fetching categories' });
    }
});


const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        // Specify the directory where the uploaded files should be stored
        if (file.fieldname === 'cover') {
            cb(null, '../../static/covers/');
        } else if (file.fieldname === 'pdf') {
            cb(null, '../../static/pdfs/');
        }
    },
    filename: (req, file, cb) => {
        // Extract file extension from the original filename
        const fileExtension = path.extname(file.originalname); 
        // Give a unique name to each file to avoid conflicts, and append the file extension
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + fileExtension); // Appends the file extension
    }
});
// Delete Book
app.delete("/deleteBook", async (req, res) => {
  const { bookId } = req.query;

  if (!bookId) {
    return res.status(400).json({ success: false, error: "Book ID is required" });
  }

  try {
    // Use your stored procedure or direct SQL query to delete the book
    await pool.execute("CALL DeleteBook(?)", [bookId]);
    res.json({ success: true, message: "Book deleted successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

const upload = multer({ storage: storage });


// Handle the form submission with multiple files or just filenames
app.post(
  '/addBook',
  upload.fields([{ name: 'cover', maxCount: 1 }, { name: 'pdf', maxCount: 1 }]),
  async (req, res) => {
      const {
          bookId,
          title,
          author,
          publisherId,
          categories,
          coverFilename,
          pdfFilename
      } = req.body;

      // Determine cover and PDF filenames
      const cover = coverFilename || (req.files && req.files.cover ? req.files.cover[0].filename : null);
      const pdf = pdfFilename || (req.files && req.files.pdf ? req.files.pdf[0].filename : null);

      try {
          const connection = await pool.getConnection();
          await connection.beginTransaction();

          // Determine whether to use the provided bookId or generate a new one
          let generatedBookId;
          if (bookId && bookId !== 'NULL') {
              generatedBookId = bookId;
          } else {
              // Generate a new book_id
              const [maxResult] = await connection.query(
                  "SELECT MAX(CAST(SUBSTRING(book_id, 2) AS UNSIGNED)) AS maxId FROM Books"
              );
              const nextId = maxResult[0].maxId ? maxResult[0].maxId + 1 : 1;
              generatedBookId = `B${String(nextId).padStart(7, '0')}`;
          }

          // Insert or update the book information
          await connection.query(
              'CALL AddBook(?, ?, ?, ?, ?, ?)',
              [generatedBookId, title, author, publisherId, cover, pdf]
          );

          // Parse and insert categories
          const categoryIds = JSON.parse(categories);
          for (const categoryId of categoryIds) {
              await connection.query('CALL AddBookCategory(?, ?)', [generatedBookId, categoryId]);
          }

          await connection.commit();
          connection.release();
          res.status(200).json({ message: 'Book added or updated successfully', bookId: generatedBookId });
      } catch (error) {
          console.error(error);
          res.status(500).json({ error: 'Error adding or updating book' });
      }
  }
);


// Get Book Details
app.get("/getBookDetails", async (req, res) => {
    const { bookId, userId } = req.query;
  
    try {
      // Call the GetBookDetails stored procedure
      const [rows] = await pool.execute("CALL GetBookDetails(?, ?)", [bookId, userId]);
  
      // If no results, return an error
      if (rows.length === 0) {
        return res.status(404).json({ success: false, error: "Book not found" });
      }
  
      // Extract book details from the result
      const book = rows[0][0];
  
      // Format the response to match the expected structure for Svelte
      res.json({
        success: true,
        book: {
          title: book.title,
          author: book.author,
          pageCount: book.page_count,
          filePath: book.file_path,
          coverPath: book.cover_path,
          seriesName: book.series_name,
          seriesOrder: book.series_order,
          publicationType: book.publication_type,
          totalReaders: book.total_readers,
          totalFavorites: book.total_favorites,
          totalFollowers: book.total_followers,
          categories: book.categories ? book.categories.split(",") : [],
          description: book.description || "", // Assuming book_desc is optional
          totalTimeSpent: book.total_time_spent,
          lastReadPage: book.last_read_page,
          isFavorite: book.is_favorite,
        },
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, error: err.message });
    }
  });
  

// Get All Books
app.get("/getAllBooks", async (req, res) => {
  try {
    const [rows] = await pool.execute("CALL GetAllBooks()");
    res.json({ success: true, books: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Delete User History
app.delete("/user/history", async (req, res) => {
  const { userId } = req.query;

  try {
    await pool.execute("CALL DeleteUserHistory(?)", [userId]);
    res.json({ success: true, message: "User history deleted successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get User History
app.get("/user/history", async (req, res) => {
  const { userId } = req.query;

  try {
    const [rows] = await pool.execute("CALL GetUserHistory(?)", [userId]);
    res.json({ success: true, history: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Start the server
const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
