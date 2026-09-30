import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { supabase } from "./supabaseClient";

export default function App() {
  const [status, setStatus] = useState("Checking connection...");

  useEffect(() => {
    supabase
      .from("species")
      .select("*")
      .then(({ error }) => {
        if (error) {
          setStatus(`Connection error: ${error.message}`);
        } else {
          setStatus("Connected to Supabase successfully!");
        }
      });
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Niah Biodiversity System</Text>
      <Text style={styles.status}>{status}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fff",
  },
  title: {
    fontSize: 24,
    marginBottom: 12,
    color: "#000",
  },
  status: {
    color: "#000",
  },
});
