
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
require("dotenv").config();
const Stripe = require("stripe");


//  App Configuration
const app = express();
const port = process.env.PORT || 3000;
const stripe = new Stripe(process.env.PAYMENT_GETWAY_KEY);


//  Middleware

app.use(
  cors({
    origin: "https://mealmate-93072.web.app", 
    credentials: true,
  })
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));


//  MongoDB Connection

const uri = `mongodb+srv://${process.env.MONGO_USER}:${process.env.MONGO_PASS}@cluster0.ddy6nyc.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

//  Main Server Logic
async function run() {
  try {
    await client.connect();

    // Collections
    const usersCollection = client.db("mealmate").collection("users");
    const mealsCollection = client.db("mealmate").collection("meals");
    const upcomingMealsCollection = client.db("mealmate").collection("upcomingmeals");
    const reviewCollection = client.db("mealmate").collection("mealsreview");
    const requestsCollection = client.db("mealmate").collection("requests");
    const paymentCollection = client.db("mealmate").collection("paymentHistory");


    //  Root Route

    app.get("/", (req, res) => {
      res.send("Server is running!");
    });


    //  User Routes

    app.post("/users", async (req, res) => {
      const user = req.body;
      const existing = await usersCollection.findOne({ email: user.email });
      if (existing) return res.json({ success: false, message: "User already exists" });

      const result = await usersCollection.insertOne(user);
      res.send(result);
    });

    app.get("/user/:email", async (req, res) => {
      const user = await usersCollection.findOne({ email: req.params.email });
      if (!user) return res.status(404).json({ error: "User not found" });
      res.send(user);
    });

    app.get("/users/recent/:email", async (req, res) => {
      const users = await usersCollection.find({ email: { $ne: req.params.email } }).toArray();
      res.send(users);
    });

    app.get("/users/search", async (req, res) => {
      const { email } = req.query;
      if (!email) return res.status(400).json({ error: "Email is required" });
      const user = await usersCollection.findOne({ email });
      if (!user) return res.status(404).json({ error: "User not found" });
      res.send([user]);
    });

    app.patch("/users/:id/role", async (req, res) => {
      const { role } = req.body;
      if (!["admin", "user"].includes(role))
        return res.status(400).json({ error: "Invalid role" });

      const result = await usersCollection.updateOne(
        { _id: new ObjectId(req.params.id) },
        { $set: { role } }
      );
      if (result.modifiedCount === 0)
        return res.status(404).json({ error: "User not found or role unchanged" });

      res.send({ success: true });
    });


    //  Meal Routes

    app.post("/meals", async (req, res) => {
      const meal = req.body;
      if (meal.ingredients && typeof meal.ingredients === "string") {
        meal.ingredients = meal.ingredients.split(",").map(i => i.trim()).filter(Boolean);
      }
      const result = await mealsCollection.insertOne(meal);
      res.send({ success: true, insertedId: result.insertedId });
    });

    app.get("/meals", async (req, res) => {
      const { search, category, sortBy = "date", sortOrder = "desc" } = req.query;
      const query = {};
      if (search) query.title = { $regex: search, $options: "i" };
      if (category && category !== "All") query.category = category.toLowerCase();

      const sortOptions = {};
      sortOptions[sortBy === "price" ? "price" : sortBy === "category" ? "category" : "date"] =
        sortOrder === "asc" ? 1 : -1;

      const meals = await mealsCollection.find(query).sort(sortOptions).toArray();
      res.send(meals);
    });

    app.get("/meals/three", async (_, res) => {
      const meals = await mealsCollection.find({}).sort({ date: -1 }).limit(3).toArray();
      res.send(meals);
    });

    app.get("/meals-by-category", async (req, res) => {
      const { category, limit = 3 } = req.query;
      const query = category ? { category: { $regex: new RegExp(`^${category}$`, "i") } } : {};
      const meals = await mealsCollection.find(query).sort({ date: -1 }).limit(parseInt(limit)).toArray();
      res.send(meals);
    });

    app.get("/meals/search", async (req, res) => {
      const { title } = req.query;
      if (!title) return res.status(400).json({ error: "Title query is required" });
      const meal = await mealsCollection.findOne({ title: { $regex: new RegExp(`^${title}$`, "i") } });
      if (!meal) return res.status(404).json({ error: "Meal not found" });
      res.send(meal);
    });

    app.get("/meals/:id", async (req, res) => {
      if (!ObjectId.isValid(req.params.id)) return res.status(400).json({ error: "Invalid ID" });
      const query = { _id: new ObjectId(req.params.id) };
      let meal = await mealsCollection.findOne(query);
      if (!meal) meal = await upcomingMealsCollection.findOne(query);
      if (!meal) return res.status(404).json({ error: "Meal not found" });
      res.send(meal);
    });

    app.put("/meals/:id", async (req, res) => {
      const updatedMeal = req.body;
      if (updatedMeal.ingredients && typeof updatedMeal.ingredients === "string") {
        updatedMeal.ingredients = updatedMeal.ingredients.split(",").map(i => i.trim()).filter(Boolean);
      }
      const result = await mealsCollection.updateOne(
        { _id: new ObjectId(req.params.id) },
        { $set: updatedMeal }
      );
      if (result.modifiedCount === 0)
        return res.status(404).json({ success: false, message: "Meal not found or not updated." });
      res.json({ success: true, message: "Meal updated successfully." });
    });

    app.delete("/meals/:id", async (req, res) => {
      if (!ObjectId.isValid(req.params.id)) return res.status(400).json({ error: "Invalid meal ID" });
      const query = { _id: new ObjectId(req.params.id) };
      const mealResult = await mealsCollection.deleteOne(query);
      if (mealResult.deletedCount === 0) return res.status(404).json({ error: "Meal not found" });
      const reviewsResult = await reviewCollection.deleteMany({ mealId: new ObjectId(req.params.id) });
      res.send({ success: true, message: `Meal deleted. Removed ${reviewsResult.deletedCount} reviews.` });
    });

    // Like / Dislike
    app.patch("/meals/:id/like", async (req, res) => {
      const { action } = req.body;
      if (!ObjectId.isValid(req.params.id)) return res.status(400).json({ error: "Invalid ID" });
      if (!["like", "dislike"].includes(action)) return res.status(400).json({ error: "Invalid action" });

      const inc = action === "like" ? 1 : -1;
      const query = { _id: new ObjectId(req.params.id) };
      let result = await mealsCollection.updateOne(query, { $inc: { likes: inc } });
      if (result.modifiedCount === 0) {
        await upcomingMealsCollection.updateOne(query, { $inc: { likes: inc } });
      }
      res.send({ success: true, action });
    });


    //  Upcoming Meals

    app.post("/upcoming-meals", async (req, res) => {
      const mealData = req.body;
      if (!mealData.title || !mealData.category || !mealData.price)
        return res.status(400).json({ success: false, message: "Missing required fields." });
      if (mealData.ingredients && typeof mealData.ingredients === "string") {
        mealData.ingredients = mealData.ingredients.split(",").map(i => i.trim()).filter(Boolean);
      }
      const result = await upcomingMealsCollection.insertOne(mealData);
      res.json({ success: true, insertedId: result.insertedId });
    });

    app.get("/upcoming-meals", async (_, res) => {
      const upcomingMeals = await upcomingMealsCollection.find({}).sort({ date: -1 }).toArray();
      res.send(upcomingMeals);
    });

    app.post("/upcoming-meals/:id", async (req, res) => {
      if (!ObjectId.isValid(req.params.id)) return res.status(400).json({ error: "Invalid meal ID" });
      const meal = await upcomingMealsCollection.findOne({ _id: new ObjectId(req.params.id) });
      if (!meal) return res.status(404).json({ error: "Upcoming meal not found" });

      const { _id, ...data } = { ...meal, status: "ongoing" };
      const result = await mealsCollection.insertOne(data);
      await upcomingMealsCollection.deleteOne({ _id: new ObjectId(req.params.id) });

      res.json({ success: true, insertedId: result.insertedId, message: "Meal published successfully." });
    });


    //  Reviews

    app.post("/reviews", async (req, res) => {
      const { mealId, text, ...rest } = req.body;
      if (!mealId || !text) return res.status(400).json({ error: "mealId and text are required" });

      const review = {
        mealId: new ObjectId(mealId),
        text,
        date: new Date(),
        ...rest,
        userId: rest.userId ? new ObjectId(rest.userId) : null,
      };
      await reviewCollection.insertOne(review);

      const query = { _id: new ObjectId(mealId) };
      let result = await mealsCollection.updateOne(query, { $inc: { reviews: 1 } });
      if (result.modifiedCount === 0) {
        await upcomingMealsCollection.updateOne(query, { $inc: { reviews: 1 } });
      }

      res.send({ success: true });
    });

    app.get("/reviews", async (_, res) => {
      const reviews = await reviewCollection.find().toArray();
      res.send(reviews);
    });

    app.get("/reviews/user/:email", async (req, res) => {
      const reviews = await reviewCollection.find({ email: req.params.email }).toArray();
      res.send(reviews);
    });

    app.get("/reviews/meal/:id", async (req, res) => {
      if (!ObjectId.isValid(req.params.id)) return res.status(400).json({ error: "Invalid meal ID" });
      const reviews = await reviewCollection.find({ mealId: new ObjectId(req.params.id) }).sort({ date: -1 }).toArray();
      res.send(reviews);
    });

    app.get("/reviews/:id", async (req, res) => {
      if (!ObjectId.isValid(req.params.id)) return res.status(400).json({ error: "Invalid review ID" });
      const review = await reviewCollection.findOne({ _id: new ObjectId(req.params.id) });
      if (!review) return res.status(404).json({ error: "Review not found" });
      res.send(review);
    });

    app.patch("/reviews/:id", async (req, res) => {
      const result = await reviewCollection.updateOne(
        { _id: new ObjectId(req.params.id) },
        { $set: { text: req.body.text } }
      );
      if (result.modifiedCount === 0)
        return res.status(404).json({ error: "Review not found or not updated." });
      res.json({ success: true });
    });

    app.delete("/reviews/:id", async (req, res) => {
      if (!ObjectId.isValid(req.params.id)) return res.status(400).json({ error: "Invalid review ID" });
      const result = await reviewCollection.deleteOne({ _id: new ObjectId(req.params.id) });
      if (result.deletedCount === 0) return res.status(404).json({ error: "Review not found" });
      res.send({ success: true, message: "Review deleted successfully" });
    });


    //  Meal Requests

    app.post("/request-meal", async (req, res) => {
      const { userEmail, mealId } = req.body;
      if (!userEmail || !mealId)
        return res.status(400).send({ success: false, error: "Missing userEmail or mealId" });

      const exists = await requestsCollection.findOne({ userEmail, mealId });
      if (exists) return res.send({ success: false, message: "Already requested." });

      await requestsCollection.insertOne({ ...req.body, status: req.body.status || "pending", requestedAt: new Date() });
      res.send({ success: true, message: "Request created." });
    });

    app.get("/requested-meals", async (_, res) => {
      const allRequests = await requestsCollection
        .aggregate([
          {
            $addFields: {
              statusOrder: {
                $switch: {
                  branches: [
                    { case: { $eq: [{ $toLower: "$status" }, "pending"] }, then: 1 },
                    { case: { $eq: [{ $toLower: "$status" }, "served"] }, then: 2 },
                  ],
                  default: 3,
                },
              },
            },
          },
          { $sort: { statusOrder: 1, requestedAt: -1 } },
          { $project: { statusOrder: 0 } },
        ])
        .toArray();
      res.send(allRequests);
    });

    app.get("/requests/:email", async (req, res) => {
      const requests = await requestsCollection.find({ userEmail: req.params.email }).toArray();
      res.send(requests);
    });

    app.patch("/requested-meals/:id", async (req, res) => {
      const { status } = req.body;
      if (!["approved", "rejected", "Served"].includes(status))
        return res.status(400).json({ error: "Invalid status" });

      const result = await requestsCollection.updateOne(
        { _id: new ObjectId(req.params.id) },
        { $set: { status } }
      );
      if (result.modifiedCount === 0)
        return res.status(404).json({ error: "Request not found or status unchanged" });
      res.send({ success: true, status });
    });

    app.delete("/requests/:id", async (req, res) => {
      if (!ObjectId.isValid(req.params.id)) return res.status(400).json({ error: "Invalid request ID" });
      const result = await requestsCollection.deleteOne({ _id: new ObjectId(req.params.id) });
      if (result.deletedCount === 0) return res.status(404).json({ error: "Request not found" });
      res.send({ success: true, message: "Request deleted successfully" });
    });


    //  Stripe Payments

    app.post("/create-payment-intent", async (req, res) => {
      try {
        const { amount } = req.body;
        const paymentIntent = await stripe.paymentIntents.create({
          amount,
          currency: "usd",
          payment_method_types: ["card"],
        });
        res.send({ clientSecret: paymentIntent.client_secret });
      } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
      }
    });

    app.post("/confirm-payment", async (req, res) => {
      try {
        const { userEmail, planName, amount, transactionId } = req.body;
        const badgeUpdate = await usersCollection.updateOne(
          { email: userEmail },
          { $set: { badge: planName } }
        );
        const paymentRecord = await paymentCollection.insertOne({
          userEmail,
          planName,
          amount,
          transactionId,
          status: "complete",
          date: new Date(),
        });
        res.send({ success: true, badgeUpdate, paymentRecord });
      } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
      }
    });




    app.get("/payments/:email", async (req, res) => {
      const history = await paymentCollection.find({ userEmail: req.params.email }).toArray();
      if (history.length === 0)
        return res.status(404).json({ error: "No payment history found for this user" });
      res.send(history);
    });




    // Confirm DB connection
    await client.db("admin").command({ ping: 1 });
    console.log("Connected to MongoDB!");
  } finally {
    // Keep the client open for the app’s lifetime
  }
}

run().catch(console.dir);

// =======================
//  Start Server
// =======================
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});